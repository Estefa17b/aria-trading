import { useState, useEffect, useRef, useCallback } from "react";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";

// ─── API KEYS — pon tus keys aquí o en .env ───────────────────────────────────
const ANTHROPIC_KEY = process.env.REACT_APP_ANTHROPIC_KEY || "";
const FINNHUB_KEY   = process.env.REACT_APP_FINNHUB_KEY   || "";

// ─── Assets ───────────────────────────────────────────────────────────────────
const ASSET_GROUPS = {
  Crypto: [
    { id:"BTCUSDT",    label:"BTC/USDT", name:"Bitcoin",       icon:"₿",  src:"binance",  fh:"BINANCE:BTCUSDT" },
    { id:"ETHUSDT",    label:"ETH/USDT", name:"Ethereum",      icon:"Ξ",  src:"binance",  fh:"BINANCE:ETHUSDT" },
    { id:"SOLUSDT",    label:"SOL/USDT", name:"Solana",        icon:"◎",  src:"binance",  fh:"BINANCE:SOLUSDT" },
  ],
  Forex: [
    { id:"EURUSD=X", label:"EUR/USD", name:"Euro/Dollar",  icon:"€", src:"yahoo" },
    { id:"GBPUSD=X", label:"GBP/USD", name:"Pound/Dollar", icon:"£", src:"yahoo" },
    { id:"JPY=X",    label:"USD/JPY", name:"Dollar/Yen",   icon:"¥", src:"yahoo" },
  ],
  Equities: [
    { id:"SPY", label:"S&P 500", name:"S&P 500 ETF",    icon:"📈", src:"yahoo" },
    { id:"QQQ", label:"NASDAQ",  name:"Nasdaq 100 ETF", icon:"⬡",  src:"yahoo" },
  ],
  Commodities: [
    { id:"GC=F", label:"XAU/USD", name:"Gold Futures",    icon:"Au", src:"yahoo" },
    { id:"CL=F", label:"WTI Oil", name:"Crude Oil Futures",icon:"🛢", src:"yahoo" },
  ],
};

const ALL_ASSETS   = Object.values(ASSET_GROUPS).flat();
const LEVERAGE_OPS = [1, 2, 3, 5, 10, 20, 50];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt    = (n, d=2) => Number(n).toLocaleString("en-US", {minimumFractionDigits:d, maximumFractionDigits:d});
const fmtTS  = () => new Date().toLocaleString("en-US", {month:"short", day:"numeric", hour:"2-digit", minute:"2-digit"});
const fmtCD  = s => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
const sleep  = ms => new Promise(r => setTimeout(r, ms));

// ─── Indicators ───────────────────────────────────────────────────────────────
function calcRSI(closes, p=14) {
  if (closes.length < p+1) return null;
  let g=0, l=0;
  for (let i=closes.length-p; i<closes.length; i++) {
    const d = closes[i]-closes[i-1];
    if (d>0) g+=d; else l-=d;
  }
  const ag=g/p, al=l/p;
  return al===0 ? 100 : 100-100/(1+ag/al);
}
function ema(arr, p) {
  const k=2/(p+1); let e=arr[0];
  for (let i=1;i<arr.length;i++) e=arr[i]*k+e*(1-k);
  return e;
}
function calcMACD(closes) {
  if (closes.length<26) return {macd:null, signal:null};
  const m = ema(closes.slice(-26),12) - ema(closes,26);
  return {macd:+m.toFixed(6), signal:+(m*0.9).toFixed(6)};
}

// ─── Binance REST + WS ────────────────────────────────────────────────────────
async function binanceKlines(symbol, limit=48) {
  const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=${limit}`);
  const raw = await r.json();
  return raw.map(k => ({
    time: new Date(k[0]).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}),
    open:+k[1], high:+k[2], low:+k[3], close:+k[4], volume:+k[5], value:+k[4],
  }));
}
async function binanceTicker(symbol) {
  const r = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
  const t = await r.json();
  return {price:+t.lastPrice, ch24:+t.priceChangePercent, high24:+t.highPrice, low24:+t.lowPrice, vol24:+t.quoteVolume};
}

// ─── Finnhub REST ─────────────────────────────────────────────────────────────
async function finnhubQuote(symbol) {
  const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`);
  const d = await r.json();
  if (!d.c) throw new Error("No data");
  return {
    price: d.c,
    ch24:  ((d.c - d.pc) / d.pc) * 100,
    high24: d.h, low24: d.l,
    vol24:  d.c * 1e6, // volume approximation
    open:   d.o, prevClose: d.pc,
  };
}

async function finnhubCandles(symbol, limit=48) {
  const to   = Math.floor(Date.now()/1000);
  const from = to - limit * 3600;
  const r = await fetch(`https://finnhub.io/api/v1/forex/candle?symbol=${symbol}&resolution=60&from=${from}&to=${to}&token=${FINNHUB_KEY}`);
  const d = await r.json();
  if (!d.c || d.s === "no_data") throw new Error("No candles");
  return d.c.map((close, i) => ({
    time:   new Date(d.t[i]*1000).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}),
    open:   d.o[i], high:d.h[i], low:d.l[i], close,
    volume: d.v?.[i] || close*1000, value: close,
  }));
}

async function yahooData(symbol, limit=48) {
  // Use our own Netlify function as proxy (no CORS issues)
  const r = await fetch(`/.netlify/functions/yahoo?symbol=${encodeURIComponent(symbol)}`);
  const d = await r.json();
  const result = d?.chart?.result?.[0];
  if (!result) throw new Error("No data");
  const meta = result.meta;
  const timestamps = result.timestamp;
  const q = result.indicators.quote[0];
  const klines = timestamps.slice(-limit).map((t, i) => ({
    time:   new Date(t*1000).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}),
    open:   +(q.open[i]||0).toFixed(2),
    high:   +(q.high[i]||0).toFixed(2),
    low:    +(q.low[i]||0).toFixed(2),
    close:  +(q.close[i]||0).toFixed(2),
    volume: q.volume[i]||0,
    value:  +(q.close[i]||0).toFixed(2),
  })).filter(k => k.close > 0);
  const price = meta.regularMarketPrice;
  const prev  = meta.chartPreviousClose || meta.previousClose;
  const ticker = {
    price,
    ch24:   prev ? ((price - prev) / prev) * 100 : 0,
    high24: meta.regularMarketDayHigh || price * 1.01,
    low24:  meta.regularMarketDayLow  || price * 0.99,
    vol24:  (meta.regularMarketVolume || 0) * price,
  };
  return { klines, ticker };
}

// ─── Finnhub News ─────────────────────────────────────────────────────────────
async function fetchMarketNews() {
  const r = await fetch(`https://finnhub.io/api/v1/news?category=general&token=${FINNHUB_KEY}`);
  const data = await r.json();
  return data.slice(0, 8).map(n => ({
    headline: n.headline,
    summary:  n.summary?.slice(0,200) || "",
    source:   n.source,
    url:      n.url,
    datetime: new Date(n.datetime*1000).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}),
    sentiment: n.sentiment || null,
  }));
}

// ─── Simulated fallback ────────────────────────────────────────────────────────
function simKlines(base, n=48) {
  let v=base;
  return Array.from({length:n},(_,i)=>{
    const o=v;
    v=Math.max(base*0.7, v*(1+(Math.random()-0.49)*0.006));
    const d=new Date(); d.setHours(d.getHours()-(n-i));
    return {
      time:`${d.getHours().toString().padStart(2,"0")}:00`,
      open:o, high:Math.max(o,v)*1.003, low:Math.min(o,v)*0.997,
      close:v, volume:Math.random()*4e8+5e7, value:v,
    };
  });
}
const SIM_BASES = {EURUSD:1.085,GBPUSD:1.265,USDJPY:149.5,SPY:527,QQQ:448,XAUUSD:2320,WTIUSD:78.4};

// ─── Color palette ─────────────────────────────────────────────────────────────
const palette = dark => dark ? {
  bg:"#080d18", surface:"#0e1525", card:"#111e30", border:"#192840",
  muted:"#1e304a", subtle:"#4a6585", text:"#b5cde0", heading:"#eaf2fa",
  accent:"#2563eb", accentBg:"rgba(37,99,235,0.11)",
  long:"#10b981", short:"#ef4444", wait:"#f59e0b",
  shadow:"0 4px 32px rgba(0,0,0,0.55)", card2:"0 2px 8px rgba(0,0,0,0.35)",
} : {
  bg:"#f0f4fb", surface:"#ffffff", card:"#ffffff", border:"#e0e8f4",
  muted:"#dce6f5", subtle:"#7a9abf", text:"#2d4a68", heading:"#091929",
  accent:"#1d4ed8", accentBg:"rgba(29,78,216,0.07)",
  long:"#059669", short:"#dc2626", wait:"#b45309",
  shadow:"0 4px 28px rgba(9,25,41,0.10)", card2:"0 1px 4px rgba(9,25,41,0.07)",
};

// ─── Chart Tooltip ─────────────────────────────────────────────────────────────
const CTip = ({active,payload,label,C,isPrice,dp=2}) => {
  if (!active||!payload?.length) return null;
  return (
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 14px",boxShadow:C.shadow}}>
      <p style={{fontSize:10,color:C.subtle,marginBottom:2}}>{label}</p>
      <p style={{fontSize:13,fontWeight:700,color:C.heading,fontFamily:"'DM Mono'"}}>
        {isPrice?"$":""}{fmt(payload[0].value, isPrice?dp:0)}
      </p>
    </div>
  );
};

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [dark, setDark]             = useState(false);
  const [lang, setLang]             = useState("es");
  const [asset, setAsset]           = useState(ALL_ASSETS[0]);
  const [tab, setTab]               = useState("dashboard");
  const [ticker, setTicker]         = useState(null);
  const [klines, setKlines]         = useState([]);
  const [dataStatus, setDataStatus] = useState("connecting");
  const [rsi, setRsi]               = useState(null);
  const [macd, setMacd]             = useState({});
  const [signal, setSignal]         = useState(null);
  const [analyzing, setAnalyzing]   = useState(false);
  const [history, setHistory]       = useState([]);
  const [news, setNews]             = useState([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [capital, setCapital]       = useState(1000);
  const [capInput, setCapInput]     = useState("1000");
  const [leverage, setLeverage]     = useState(null);
  const [autoOn, setAutoOn]         = useState(false);
  const [countdown, setCd]          = useState(3600);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [noKeys, setNoKeys]         = useState(false);

  const wsRef  = useRef(null);
  const cdRef  = useRef(null);
  const klRef  = useRef([]);
  const C = palette(dark);

  const recompute = useCallback((kl) => {
    const closes = kl.map(k=>k.close);
    setRsi(calcRSI(closes));
    setMacd(calcMACD(closes));
  }, []);

  // ── Load news ──────────────────────────────────────────────────────────────
  const loadNews = useCallback(async () => {
    if (!FINNHUB_KEY) return;
    setNewsLoading(true);
    try {
      const n = await fetchMarketNews();
      setNews(n);
    } catch {}
    setNewsLoading(false);
  }, []);

  useEffect(() => { loadNews(); }, [loadNews]);

  // ── Load market data ───────────────────────────────────────────────────────
  const loadMarket = useCallback(async (a) => {
    // Close existing WS
    if (wsRef.current) {
      if (wsRef.current._sim) clearInterval(wsRef.current._iv);
      else try { wsRef.current.close(1000); } catch {}
      wsRef.current = null;
    }

    setDataStatus("connecting");
    setKlines([]); setTicker(null); klRef.current = [];

    if (a.src === "binance") {
      // ── Binance: REST history + WS live ──
      try {
        const [kl, tk] = await Promise.all([binanceKlines(a.id), binanceTicker(a.id)]);
        klRef.current = kl;
        setKlines(kl);
        setTicker(tk);
        recompute(kl);
        setDataStatus("live");
      } catch {
        setDataStatus("error");
        return;
      }

      // WS for live updates
      try {
        const sym = a.id.toLowerCase();
        const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${sym}@miniTicker/${sym}@kline_1h`);
        ws.onmessage = (evt) => {
          try {
            const msg = JSON.parse(evt.data);
            if (msg.e === "24hrMiniTicker") {
              setTicker(prev => prev ? ({
                ...prev, price:+msg.c,
                ch24:((+msg.c-+msg.o)/+msg.o)*100,
                high24:+msg.h, low24:+msg.l, vol24:+msg.q,
              }) : null);
            }
            if (msg.e === "kline") {
              const k = msg.k;
              const bar = {
                time: new Date(k.t).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}),
                open:+k.o, high:+k.h, low:+k.l, close:+k.c, volume:+k.v, value:+k.c,
              };
              klRef.current = klRef.current.at(-1)?.time === bar.time
                ? [...klRef.current.slice(0,-1), bar]
                : [...klRef.current.slice(-47), bar];
              setKlines([...klRef.current]);
              recompute(klRef.current);
            }
          } catch {}
        };
        wsRef.current = ws;
      } catch {}

    } else if (a.src === "yahoo" || (a.src === "finnhub" && FINNHUB_KEY)) {
      // ── Finnhub: real data ──
      try {
        const { klines: kl, ticker: tk } = await yahooData(a.id);
        klRef.current = kl;
        setKlines(kl);
        setTicker(tk);
        recompute(kl);
        setDataStatus("live");

        // Poll Yahoo every 60s
        const iv = setInterval(async () => {
          try {
            const { ticker: tk2 } = await yahooData(a.id, 1);
            setTicker(tk2);
          } catch {}
        }, 60000);
        wsRef.current = { _sim:true, _iv:iv };
      } catch {
        // Fallback to sim if Finnhub fails
        startSim(a);
      }

    } else if (a.src === "sim") {
      startSim(a);
    } else {
      startSim(a);
    }
  }, [recompute]);

  function startSim(a) {
    const base = SIM_BASES[a.id] || 100;
    const kl = simKlines(base);
    klRef.current = kl;
    setKlines(kl);
    const price = base*(1+(Math.random()-0.5)*0.008);
    setTicker({price, ch24:(Math.random()-0.45)*2, high24:price*1.01, low24:price*0.99, vol24:price*1e6});
    recompute(kl);
    setDataStatus(FINNHUB_KEY ? "sim" : "no-key");
    const iv = setInterval(() => {
      const p2 = base*(1+(Math.random()-0.5)*0.008);
      setTicker({price:p2, ch24:(Math.random()-0.45)*2, high24:p2*1.01, low24:p2*0.99, vol24:p2*1e6});
    }, 5000);
    wsRef.current = {_sim:true, _iv:iv};
  }

  useEffect(() => {
    if (!ANTHROPIC_KEY && !FINNHUB_KEY) setNoKeys(true);
    loadMarket(asset);
    return () => {
      if (wsRef.current) {
        if (wsRef.current._sim) clearInterval(wsRef.current._iv);
        else try { wsRef.current.close(1000); } catch {}
      }
    };
  }, [asset]); // eslint-disable-line

  // ── Auto countdown ─────────────────────────────────────────────────────────
  useEffect(() => {
    clearInterval(cdRef.current);
    if (!autoOn) { setCd(3600); return; }
    setCd(3600);
    cdRef.current = setInterval(() => {
      setCd(n => { if (n<=1) { runSignal(); return 3600; } return n-1; });
    }, 1000);
    return () => clearInterval(cdRef.current);
  }, [autoOn, asset]); // eslint-disable-line

  // ── AI Signal ──────────────────────────────────────────────────────────────
  const runSignal = async () => {
    if (!ticker) return;
    if (!ANTHROPIC_KEY) { setSignal({error:true, errorMsg:"no-key"}); return; }
    setAnalyzing(true); setSignal(null);

    const {price, ch24, high24, low24} = ticker;
    const closes  = klines.map(k=>k.close);
    const vols    = klines.map(k=>k.volume);
    const avgVol  = vols.reduce((a,b)=>a+b,0)/(vols.length||1);
    const volRatio = ((vols.at(-1)||0)/avgVol).toFixed(2);
    const dp = price>100?2:price>1?4:6;

    const histCtx = history.slice(-5).map(s=>
      `[${s.time}] ${s.signal} @$${s.priceAtSignal} conf:${s.confidence}% lev:${s.leverage}x`
    ).join("\n") || "Sin señales previas.";

    const newsCtx = news.slice(0,5).map(n=>
      `- [${n.datetime}] ${n.source}: ${n.headline}`
    ).join("\n") || "Sin noticias disponibles.";

    const prompt = `Eres ARIA, agente cuantitativo de trading con IA avanzada. Genera una señal de trading horaria COMPLETA y DETALLADA para ${asset.label} (${asset.name}).

═══ DATOS DE MERCADO EN TIEMPO REAL ═══
Precio actual: $${fmt(price,dp)}
Cambio 24h: ${ch24>=0?"+":""}${ch24.toFixed(3)}%
Máximo 24h: $${fmt(high24,dp)} | Mínimo 24h: $${fmt(low24,dp)}
RSI(14): ${rsi?rsi.toFixed(2):"N/D"} ${rsi>70?"⚠ SOBRECOMPRADO":rsi<30?"⚠ SOBREVENDIDO":""}
MACD: ${macd.macd??"N/D"} | Señal MACD: ${macd.signal??"N/D"}
Ratio volumen vs media 48h: ${volRatio}x
Rango 48h: $${closes.length?fmt(Math.min(...closes),dp):"N/D"} - $${closes.length?fmt(Math.max(...closes),dp):"N/D"}
Capital del usuario: $${fmt(capital,2)} | Apalancamiento máximo: 50x

═══ NOTICIAS GLOBALES EN VIVO ═══
${newsCtx}

═══ HISTORIAL DE SEÑALES (aprendizaje) ═══
${histCtx}

═══ INSTRUCCIONES ═══
1. Analiza el impacto de CADA noticia en ${asset.label} específicamente
2. Determina si la tendencia horaria es ALCISTA, BAJISTA o LATERAL
3. El apalancamiento debe reflejar la certeza: alta volatilidad por noticias = menos apalancamiento
4. Calcula niveles exactos de entrada, SL y TP basados en el precio actual
5. Aprende del historial para no repetir errores

Responde ÚNICAMENTE con JSON válido sin backticks:
{
  "signal": "LONG"|"SHORT"|"ESPERAR",
  "confidence": <40-95>,
  "leverage": <de [1,2,3,5,10,20,50]>,
  "leverageRationale": "<por qué este apalancamiento dado el contexto de noticias y volatilidad>",
  "entry": <precio exacto>,
  "stopLoss": <precio exacto>,
  "takeProfit": <precio exacto>,
  "riskRewardRatio": <número>,
  "capitalToRisk": <1-10>,
  "positionSize": <capital*leverage*capitalToRisk/100>,
  "summary": "<análisis técnico + fundamental en 3 oraciones>",
  "technicalBasis": "<RSI, MACD, volumen con valores exactos>",
  "newsImpact": "<cómo las noticias en vivo afectan este activo específicamente>",
  "trendAnalysis": "<análisis de tendencia horaria: alcista/bajista/lateral con justificación>",
  "keyLevels": ["<soporte1>","<soporte2>","<resistencia1>"],
  "marketStructure": "alcista"|"bajista"|"lateral",
  "hourlyOutlook": "<predicción para las próximas 3 horas con precios objetivo>",
  "learningNote": "<qué aprendiste del historial de señales>",
  "warning": "<riesgo principal a vigilar>",
  "timeframe": "1H"
}`;

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model:"claude-sonnet-4-5",
          max_tokens:1500,
          messages:[{role:"user", content:prompt}],
        }),
      });
      const data   = await res.json();
      if (data.error) throw new Error(data.error.message);
      const raw    = data.content?.map(b=>b.text||"").join("")||"";
      const parsed = JSON.parse(raw.replace(/```json|```/g,"").trim());
      const entry  = {...parsed, priceAtSignal:fmt(price,dp), time:fmtTS(), asset:asset.label, assetObj:asset};
      setSignal(entry);
      setLeverage(parsed.leverage);
      setHistory(prev => [...prev.slice(-19), entry]);
    } catch(e) {
      setSignal({error:true, errorMsg: e.message?.includes("401") ? "invalid-key" : "general"});
    }
    setAnalyzing(false);
  };

  const sigColor = s => {
    if (!s) return C.accent;
    if (s==="LONG")    return C.long;
    if (s==="SHORT")   return C.short;
    return C.wait;
  };

  const price = ticker?.price ?? 0;
  const ch24  = ticker?.ch24  ?? 0;
  const isUp  = ch24 >= 0;
  const dp    = price>100?2:price>1?4:6;

  const statusLabel = {
    connecting:"Conectando…", live:"EN VIVO",
    sim:"Simulado", error:"Error", "no-key":"Sin API Key"
  }[dataStatus] || "…";
  const statusColor = {
    connecting:C.wait, live:C.long, sim:C.subtle, error:C.short, "no-key":C.short
  }[dataStatus] || C.subtle;

  // ── Sidebar ────────────────────────────────────────────────────────────────
  const SidebarContent = () => (
    <>
      <div style={{padding:"14px 14px 10px", borderBottom:`1px solid ${C.border}`}}>
        <div style={{fontSize:9,fontWeight:600,letterSpacing:1.5,textTransform:"uppercase",color:C.subtle,marginBottom:12}}>
          {lang==="es"?"Activos":"Assets"}
        </div>
        {Object.entries(ASSET_GROUPS).map(([group,items]) => (
          <div key={group} style={{marginBottom:14}}>
            <div style={{fontSize:9,color:C.subtle,letterSpacing:1.2,textTransform:"uppercase",marginBottom:6,fontWeight:600}}>{group}</div>
            {items.map(a => (
              <div key={a.id} className="mcard"
                onClick={()=>{setAsset(a);setSignal(null);setMobileOpen(false);}}
                style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 10px",borderRadius:8,marginBottom:3,cursor:"pointer",
                  background:asset.id===a.id?C.accentBg:"transparent",
                  border:`1px solid ${asset.id===a.id?C.accent:"transparent"}`,
                  transition:"all 0.15s"}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:13}}>{a.icon}</span>
                  <div>
                    <div style={{fontSize:12,fontWeight:600,color:asset.id===a.id?C.accent:C.heading}}>{a.label}</div>
                    <div style={{fontSize:9,color:C.subtle}}>{a.name}</div>
                  </div>
                </div>
                {asset.id===a.id && <div style={{width:4,height:4,borderRadius:"50%",background:C.accent}} className="pulse"/>}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Signal history */}
      <div style={{padding:"12px 14px 8px", borderBottom:`1px solid ${C.border}`}}>
        <div style={{fontSize:9,fontWeight:600,letterSpacing:1.5,textTransform:"uppercase",color:C.subtle,marginBottom:4}}>
          {lang==="es"?"Historial":"Signal History"}
        </div>
        <div style={{fontSize:10,color:C.subtle}}>
          {history.length} {lang==="es"?"señales esta sesión":"signals this session"}
        </div>
      </div>
      {history.length===0 ? (
        <div style={{padding:"20px 16px",fontSize:11,color:C.subtle,textAlign:"center",lineHeight:1.7}}>
          {lang==="es"?"Sin señales aún.\nEjecuta ARIA para comenzar.":"No signals yet.\nRun ARIA to begin."}
        </div>
      ) : [...history].reverse().map((s,i) => (
        <div key={i} style={{padding:"10px 14px",borderBottom:`1px solid ${C.border}`}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
            <span style={{fontSize:11,fontWeight:700,color:sigColor(s.signal),fontFamily:"'DM Mono'"}}>{s.signal}</span>
            <span style={{fontSize:9,color:C.subtle,fontFamily:"'DM Mono'"}}>{s.leverage}x</span>
          </div>
          <div style={{fontSize:10,color:C.text,marginBottom:1}}>{s.asset}</div>
          <div style={{fontSize:9,color:C.subtle,fontFamily:"'DM Mono'",marginBottom:4}}>${s.priceAtSignal} · {s.time}</div>
          <div style={{height:2,background:C.muted,borderRadius:1}}>
            <div style={{height:"100%",width:`${s.confidence}%`,background:sigColor(s.signal),borderRadius:1}}/>
          </div>
          <div style={{fontSize:9,color:C.subtle,marginTop:2}}>{s.confidence}% conf.</div>
        </div>
      ))}
    </>
  );

  return (
    <div style={{fontFamily:"'DM Sans',sans-serif",background:C.bg,minHeight:"100dvh",color:C.text,transition:"background 0.25s,color 0.25s"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&family=DM+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:3px;}::-webkit-scrollbar-thumb{background:${C.muted};border-radius:3px;}
        button,input{font-family:inherit;}input:focus{outline:none;}
        .mcard{transition:all 0.15s ease;cursor:pointer;}.mcard:hover{background:${C.accentBg}!important;}
        .hbtn{transition:opacity 0.15s;cursor:pointer;background:none;border:none;}.hbtn:hover{opacity:0.7;}
        .aibtn{transition:all 0.2s;cursor:pointer;border:none;font-family:inherit;}
        .aibtn:hover:not(:disabled){filter:brightness(1.08);transform:translateY(-1px);}
        .aibtn:disabled{opacity:0.5;cursor:not-allowed;}
        .levbtn{transition:all 0.15s;cursor:pointer;border:none;font-family:'DM Mono',monospace;}
        .levbtn:hover{filter:brightness(1.1);}
        .ntab{background:none;border:none;cursor:pointer;transition:all 0.15s;}
        .fade{animation:fu 0.3s ease both;}@keyframes fu{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        .pulse{animation:pl 2s ease-in-out infinite;}@keyframes pl{0%,100%{opacity:1}50%{opacity:0.2}}
        .blink{animation:bl 1s step-end infinite;}@keyframes bl{0%,100%{opacity:1}50%{opacity:0}}
        .spin{animation:sp 1s linear infinite;}@keyframes sp{to{transform:rotate(360deg)}}
        .moverlay{position:fixed;inset:0;z-index:200;overflow-y:auto;}
        .news-card:hover{background:${C.accentBg}!important;cursor:pointer;}
        @media(max-width:820px){
          .dsidebar{display:none!important;}.mobham{display:flex!important;}
          .kpigrid{grid-template-columns:1fr 1fr!important;}
          .chartgrid{grid-template-columns:1fr!important;}
          .siggrid{grid-template-columns:1fr 1fr!important;}
          .levrow{flex-wrap:wrap!important;}
          .main{padding:16px!important;}
        }
        @media(max-width:500px){.kpigrid{grid-template-columns:1fr!important;}.siggrid{grid-template-columns:1fr!important;}}
      `}</style>

      {/* No keys banner */}
      {noKeys && (
        <div style={{background:`${C.wait}18`,borderBottom:`1px solid ${C.wait}40`,padding:"10px 20px",fontSize:12,color:C.wait,display:"flex",alignItems:"center",gap:8}}>
          <span>⚠</span>
          <span>
            {lang==="es"
              ? "Configura tus API keys en el archivo .env para activar datos reales y señales IA. Ver instrucciones abajo."
              : "Set your API keys in .env to enable real data and AI signals. See instructions below."}
          </span>
        </div>
      )}

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="moverlay" style={{background:C.surface}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 16px",borderBottom:`1px solid ${C.border}`}}>
            <Logo C={C}/>
            <button className="hbtn" onClick={()=>setMobileOpen(false)} style={{fontSize:20,color:C.subtle}}>✕</button>
          </div>
          <SidebarContent/>
        </div>
      )}

      {/* Header */}
      <header style={{background:C.surface,borderBottom:`1px solid ${C.border}`,height:56,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 20px",position:"sticky",top:0,zIndex:100,boxShadow:C.card2}}>
        <Logo C={C}/>
        <nav style={{display:"flex",gap:2}}>
          {[
            ["dashboard", lang==="es"?"Panel":"Dashboard"],
            ["news",      lang==="es"?"Noticias":"News"],
            ["portfolio", lang==="es"?"Portafolio":"Portfolio"],
          ].map(([key,label]) => (
            <button key={key} className="ntab" onClick={()=>setTab(key)}
              style={{padding:"5px 14px",fontSize:12.5,fontWeight:tab===key?600:400,color:tab===key?C.accent:C.subtle,background:tab===key?C.accentBg:"transparent",borderRadius:6}}>
              {label}
            </button>
          ))}
        </nav>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{display:"flex",alignItems:"center",gap:5}}>
            <div style={{width:5,height:5,borderRadius:"50%",background:statusColor}} className={dataStatus==="live"?"pulse":""}/>
            <span style={{fontSize:9,color:statusColor,fontFamily:"'DM Mono'",letterSpacing:0.8,whiteSpace:"nowrap"}}>{statusLabel}</span>
          </div>
          <button className="hbtn" onClick={()=>setLang(l=>l==="es"?"en":"es")}
            style={{padding:"3px 10px",fontSize:11,fontWeight:600,color:C.accent,border:`1px solid ${C.border}`,borderRadius:6}}>
            {lang==="es"?"EN":"ES"}
          </button>
          <button className="hbtn" onClick={()=>setDark(d=>!d)}
            style={{padding:"3px 10px",fontSize:11,color:C.text,border:`1px solid ${C.border}`,borderRadius:6}}>
            {dark?"☀ Claro":"◑ Oscuro"}
          </button>
          <button className="hbtn mobham" onClick={()=>setMobileOpen(true)}
            style={{fontSize:18,color:C.text,display:"none",alignItems:"center"}}>☰</button>
        </div>
      </header>

      {/* Body */}
      <div style={{display:"flex",height:"calc(100dvh - 56px)"}}>
        <aside className="dsidebar" style={{width:252,borderRight:`1px solid ${C.border}`,overflowY:"auto",background:C.surface,flexShrink:0}}>
          <SidebarContent/>
        </aside>

        <main className="main" style={{flex:1,overflowY:"auto",padding:"24px 26px"}}>

          {/* ── DASHBOARD ── */}
          {tab==="dashboard" && (
            <>
              {/* Hero price */}
              <div style={{marginBottom:22}}>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8,flexWrap:"wrap"}}>
                  <span style={{fontSize:22}}>{asset.icon}</span>
                  <div>
                    <div style={{fontSize:10,color:C.subtle,letterSpacing:1.5,textTransform:"uppercase",fontWeight:600,marginBottom:2}}>
                      {asset.name} · {dataStatus==="live"
                        ? (asset.src==="binance"?"Binance WebSocket":"Finnhub Live")
                        : dataStatus==="sim" ? (lang==="es"?"Simulado":"Simulated")
                        : dataStatus==="no-key" ? (lang==="es"?"Sin API Key":"No API Key")
                        : (lang==="es"?"Conectando…":"Connecting…")}
                    </div>
                    <div style={{fontFamily:"'Libre Baskerville'",fontWeight:700,fontSize:"clamp(26px,4vw,40px)",color:C.heading,letterSpacing:-0.5,lineHeight:1.1}}>
                      {!ticker ? "—" : "$"+fmt(price,dp)}
                    </div>
                  </div>
                  {ticker && (
                    <div style={{paddingBottom:4}}>
                      <span style={{fontFamily:"'DM Mono'",fontSize:15,fontWeight:600,color:isUp?C.long:C.short}}>
                        {isUp?"+":""}{ch24.toFixed(2)}%
                      </span>
                      <span style={{fontSize:10,color:C.subtle,marginLeft:6}}>24h</span>
                    </div>
                  )}
                  <button className="hbtn" onClick={()=>loadMarket(asset)}
                    style={{marginLeft:"auto",fontSize:12,color:C.subtle,border:`1px solid ${C.border}`,borderRadius:6,padding:"4px 12px"}}>
                    ⟳ {lang==="es"?"Actualizar":"Refresh"}
                  </button>
                </div>

                {ticker && (
                  <div className="kpigrid" style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:20}}>
                    {[
                      {label:lang==="es"?"Máx 24h":"24h High", value:`$${fmt(ticker.high24,dp)}`, color:C.long},
                      {label:lang==="es"?"Mín 24h":"24h Low",  value:`$${fmt(ticker.low24,dp)}`,  color:C.short},
                      {label:lang==="es"?"Volumen":"Volume",    value:`$${fmt(ticker.vol24/1e6,1)}M`, color:C.text},
                      {label:"RSI (14)", value:rsi?rsi.toFixed(1):"—", color:rsi>70?C.short:rsi<30?C.long:C.text},
                      {label:"MACD",     value:macd.macd!=null?(macd.macd>0?"+":"")+macd.macd.toFixed(4):"—", color:macd.macd>0?C.long:C.short},
                    ].map((k,i) => (
                      <div key={i} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 14px",boxShadow:C.card2}}>
                        <div style={{fontSize:9,color:C.subtle,letterSpacing:1,textTransform:"uppercase",marginBottom:3,fontWeight:600}}>{k.label}</div>
                        <div style={{fontFamily:"'DM Mono'",fontSize:14,fontWeight:700,color:k.color}}>{k.value}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Charts */}
              {klines.length>0 && (
                <div className="chartgrid" style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:14,marginBottom:16}}>
                  <Card title={`${asset.label} · 1H · ${klines.length} ${lang==="es"?"velas":"candles"}`} C={C}>
                    <ResponsiveContainer width="100%" height={165}>
                      <AreaChart data={klines} margin={{top:4,right:8,bottom:0,left:-14}}>
                        <defs>
                          <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={isUp?C.long:C.short} stopOpacity={dark?0.28:0.18}/>
                            <stop offset="100%" stopColor={isUp?C.long:C.short} stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="2 5" stroke={C.border} vertical={false}/>
                        <XAxis dataKey="time" tick={{fontSize:8,fill:C.subtle}} tickLine={false} interval={Math.floor(klines.length/6)}/>
                        <YAxis domain={["auto","auto"]} tick={{fontSize:8,fill:C.subtle}} tickLine={false}
                          tickFormatter={v=>"$"+(v>=1000?fmt(v,0):fmt(v,dp>2?dp:2))} width={64}/>
                        <Tooltip content={<CTip C={C} isPrice dp={dp}/>}/>
                        {signal?.entry      && <ReferenceLine y={signal.entry}      stroke={C.accent} strokeDasharray="4 3" strokeWidth={1} label={{value:"Entry",fill:C.accent,fontSize:8,position:"right"}}/>}
                        {signal?.stopLoss   && <ReferenceLine y={signal.stopLoss}   stroke={C.short}  strokeDasharray="3 3" strokeWidth={1} label={{value:"SL",   fill:C.short, fontSize:8,position:"right"}}/>}
                        {signal?.takeProfit && <ReferenceLine y={signal.takeProfit} stroke={C.long}   strokeDasharray="3 3" strokeWidth={1} label={{value:"TP",   fill:C.long,  fontSize:8,position:"right"}}/>}
                        <Area type="monotone" dataKey="close" stroke={isUp?C.long:C.short} strokeWidth={1.8} fill="url(#pg)" dot={false}/>
                      </AreaChart>
                    </ResponsiveContainer>
                  </Card>
                  <Card title={lang==="es"?"Volumen":"Volume"} C={C}>
                    <ResponsiveContainer width="100%" height={165}>
                      <BarChart data={klines.slice(-20)} margin={{top:4,right:4,bottom:0,left:-26}}>
                        <CartesianGrid strokeDasharray="2 5" stroke={C.border} vertical={false}/>
                        <XAxis dataKey="time" tick={{fontSize:8,fill:C.subtle}} tickLine={false} interval={4}/>
                        <YAxis tick={{fontSize:8,fill:C.subtle}} tickLine={false} tickFormatter={v=>(v/1e6).toFixed(0)+"M"}/>
                        <Tooltip content={<CTip C={C}/>}/>
                        <Bar dataKey="volume" fill={C.accentBg} stroke={C.accent} strokeWidth={0.8} radius={[2,2,0,0]}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </Card>
                </div>
              )}

              {/* Capital & Leverage */}
              <Card title={lang==="es"?"Capital y Apalancamiento":"Capital & Leverage"} C={C}>
                <div style={{display:"flex",gap:24,flexWrap:"wrap",alignItems:"flex-start"}}>
                  <div style={{minWidth:180}}>
                    <div style={{fontSize:10,color:C.subtle,marginBottom:6,fontWeight:500}}>Capital (USD)</div>
                    <div style={{display:"flex",alignItems:"center",background:C.bg,border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>
                      <span style={{padding:"0 12px",fontSize:15,color:C.subtle,fontFamily:"'DM Mono'"}}>$</span>
                      <input type="number" value={capInput} min="1"
                        onChange={e=>setCapInput(e.target.value)}
                        onBlur={()=>{const v=parseFloat(capInput);if(!isNaN(v)&&v>0)setCapital(v);}}
                        style={{flex:1,background:"transparent",border:"none",padding:"10px 10px 10px 0",fontSize:15,fontFamily:"'DM Mono'",fontWeight:700,color:C.heading}}/>
                    </div>
                    {leverage && (
                      <div style={{marginTop:7,fontSize:11,color:C.subtle,lineHeight:1.7}}>
                        <span style={{color:C.text}}>{lang==="es"?"Posición efectiva: ":"Effective position: "}</span>
                        <span style={{fontFamily:"'DM Mono'",color:C.accent,fontWeight:700}}>${fmt(capital*leverage,0)}</span><br/>
                        <span style={{color:C.text}}>{lang==="es"?"Pérdida máxima: ":"Max loss: "}</span>
                        <span style={{fontFamily:"'DM Mono'",color:C.short,fontWeight:700}}>${fmt(capital,0)}</span>
                        {leverage>=20 && <><br/><span style={{color:C.short,fontWeight:700}}>⚠ {lang==="es"?"Alto riesgo":"High risk"}</span></>}
                      </div>
                    )}
                  </div>
                  <div style={{flex:1,minWidth:240}}>
                    <div style={{fontSize:10,color:C.subtle,marginBottom:6,fontWeight:500}}>
                      {lang==="es"?"Apalancamiento":"Leverage"}
                      {signal?.leverage && <span style={{marginLeft:8,color:C.long,fontWeight:600,fontSize:10}}>
                        ← IA {lang==="es"?"recomienda":"recommends"} {signal.leverage}x
                      </span>}
                    </div>
                    <div className="levrow" style={{display:"flex",gap:6}}>
                      {LEVERAGE_OPS.map(l => {
                        const isAI=signal?.leverage===l, isSel=leverage===l;
                        return (
                          <button key={l} className="levbtn" onClick={()=>setLeverage(l)}
                            style={{flex:1,minWidth:36,padding:"8px 0",fontSize:11,fontWeight:700,borderRadius:8,
                              background:isSel?(isAI?C.long:C.accent):isAI?`${C.long}18`:C.bg,
                              color:isSel?"#fff":isAI?C.long:C.subtle,
                              border:`1.5px solid ${isSel?(isAI?C.long:C.accent):isAI?C.long+"55":C.border}`}}>
                            {l}x
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </Card>

              {/* AI Controls */}
              <div style={{display:"flex",gap:10,margin:"14px 0",flexWrap:"wrap"}}>
                <button className="aibtn" onClick={runSignal} disabled={analyzing||!ticker}
                  style={{flex:1,minWidth:200,padding:"13px 22px",background:C.accent,borderRadius:10,color:"#fff",fontSize:13.5,fontWeight:600,boxShadow:`0 4px 18px ${C.accent}40`,display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>
                  {analyzing
                    ? <><div className="spin" style={{width:14,height:14,border:"2px solid rgba(255,255,255,0.35)",borderTopColor:"#fff",borderRadius:"50%"}}/>{lang==="es"?"ARIA Analizando…":"ARIA Analyzing…"}</>
                    : <><span style={{fontSize:16}}>✦</span>{lang==="es"?"Ejecutar Señal ARIA":"Run ARIA Signal"}</>}
                </button>
                <button className="hbtn" onClick={()=>setAutoOn(a=>!a)}
                  style={{padding:"12px 16px",borderRadius:10,border:`1.5px solid ${autoOn?C.long:C.border}`,background:autoOn?`${C.long}12`:C.card,color:autoOn?C.long:C.subtle,fontSize:12,fontWeight:600,cursor:"pointer"}}>
                  {autoOn?<><span className="blink">●</span> Auto {fmtCD(countdown)}</>:<>⏱ {lang==="es"?"Auto Horario":"Hourly Auto"}</>}
                </button>
              </div>

              {/* Error states */}
              {signal?.error && (
                <div style={{marginBottom:16,background:`${C.short}0a`,border:`1px solid ${C.short}30`,borderRadius:10,padding:"14px 18px",color:C.short,fontSize:13}}>
                  {signal.errorMsg==="no-key"
                    ? (lang==="es"
                        ? "⚠ Falta la API key de Anthropic. Configúrala en el archivo .env (ver instrucciones abajo)."
                        : "⚠ Missing Anthropic API key. Set it in the .env file (see instructions below).")
                    : signal.errorMsg==="invalid-key"
                      ? (lang==="es"?"⚠ API key inválida. Verifica tu key de Anthropic.":"⚠ Invalid API key. Check your Anthropic key.")
                      : (lang==="es"?"⚠ Error al generar señal. Verifica tu conexión.":"⚠ Failed to generate signal. Check your connection.")}
                </div>
              )}

              {/* Signal card */}
              {signal && !signal.error && (
                <div className="fade" style={{background:C.card,border:`1.5px solid ${sigColor(signal.signal)}40`,borderRadius:14,padding:"22px 24px",boxShadow:C.shadow}}>
                  {/* Header */}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:18,flexWrap:"wrap",gap:12}}>
                    <div>
                      <div style={{fontSize:9,fontWeight:600,letterSpacing:1.5,textTransform:"uppercase",color:C.subtle,marginBottom:6}}>
                        ARIA · {signal.asset} · {signal.time}
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                        <span style={{fontFamily:"'Libre Baskerville'",fontWeight:700,fontSize:30,color:sigColor(signal.signal),letterSpacing:-0.5,lineHeight:1}}>
                          {signal.signal}
                        </span>
                        <Chip label={`${signal.confidence}% conf.`} color={sigColor(signal.signal)} C={C}/>
                        <Chip label={`${signal.leverage}x`} color={C.accent} C={C}/>
                        <Chip label={signal.marketStructure} color={C.text} C={C}/>
                      </div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:9,color:C.subtle,textTransform:"uppercase",letterSpacing:1,marginBottom:3}}>R/R Ratio</div>
                      <div style={{fontFamily:"'Libre Baskerville'",fontSize:20,fontWeight:700,color:C.heading}}>1 : {fmt(signal.riskRewardRatio,2)}</div>
                    </div>
                  </div>

                  {/* Trade levels */}
                  <div className="siggrid" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:20}}>
                    {[
                      {label:lang==="es"?"Entrada":"Entry",   value:`$${fmt(signal.entry,dp)}`,      color:C.accent},
                      {label:"Stop Loss",                      value:`$${fmt(signal.stopLoss,dp)}`,   color:C.short},
                      {label:"Take Profit",                    value:`$${fmt(signal.takeProfit,dp)}`, color:C.long},
                      {label:lang==="es"?"% Riesgo":"Risk %", value:`${signal.capitalToRisk}%`,      color:C.wait},
                    ].map((m,i) => (
                      <div key={i} style={{background:C.bg,borderRadius:10,padding:"11px 14px",border:`1px solid ${C.border}`}}>
                        <div style={{fontSize:9,color:C.subtle,letterSpacing:1,textTransform:"uppercase",marginBottom:3,fontWeight:600}}>{m.label}</div>
                        <div style={{fontFamily:"'DM Mono'",fontSize:14,fontWeight:700,color:m.color}}>{m.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Summary */}
                  <p style={{fontFamily:"'Libre Baskerville'",fontStyle:"italic",fontSize:13.5,color:C.text,lineHeight:1.8,marginBottom:16}}>
                    {signal.summary}
                  </p>

                  {/* Hourly outlook */}
                  {signal.hourlyOutlook && (
                    <div style={{background:dark?`${C.accent}12`:C.accentBg,borderRadius:9,padding:"13px 16px",marginBottom:12,border:`1px solid ${C.accent}30`}}>
                      <div style={{fontSize:9,fontWeight:600,letterSpacing:1.5,textTransform:"uppercase",color:C.accent,marginBottom:6}}>
                        📅 {lang==="es"?"Predicción Horaria (próx. 3h)":"Hourly Outlook (next 3h)"}
                      </div>
                      <p style={{fontSize:12.5,color:C.text,lineHeight:1.65}}>{signal.hourlyOutlook}</p>
                    </div>
                  )}

                  {/* News impact */}
                  {signal.newsImpact && (
                    <div style={{background:dark?`rgba(245,158,11,0.08)`:`rgba(180,83,9,0.06)`,borderRadius:9,padding:"13px 16px",marginBottom:12,border:`1px solid ${C.wait}30`}}>
                      <div style={{fontSize:9,fontWeight:600,letterSpacing:1.5,textTransform:"uppercase",color:C.wait,marginBottom:6}}>
                        📰 {lang==="es"?"Impacto de Noticias en Vivo":"Live News Impact"}
                      </div>
                      <p style={{fontSize:12.5,color:C.text,lineHeight:1.65}}>{signal.newsImpact}</p>
                    </div>
                  )}

                  {/* Trend analysis */}
                  {signal.trendAnalysis && (
                    <div style={{background:C.bg,borderRadius:9,padding:"12px 16px",marginBottom:12,border:`1px solid ${C.border}`}}>
                      <div style={{fontSize:9,fontWeight:600,letterSpacing:1.5,textTransform:"uppercase",color:C.subtle,marginBottom:5}}>
                        📈 {lang==="es"?"Análisis de Tendencia":"Trend Analysis"}
                      </div>
                      <p style={{fontSize:12.5,color:C.text,lineHeight:1.65}}>{signal.trendAnalysis}</p>
                    </div>
                  )}

                  {/* Technical basis */}
                  {signal.technicalBasis && (
                    <div style={{background:C.bg,borderRadius:9,padding:"12px 16px",marginBottom:12,border:`1px solid ${C.border}`}}>
                      <div style={{fontSize:9,fontWeight:600,letterSpacing:1.5,textTransform:"uppercase",color:C.subtle,marginBottom:5}}>
                        {lang==="es"?"Base Técnica":"Technical Basis"}
                      </div>
                      <p style={{fontSize:12.5,color:C.text,lineHeight:1.65}}>{signal.technicalBasis}</p>
                    </div>
                  )}

                  {/* Key levels */}
                  {signal.keyLevels?.length>0 && (
                    <div style={{marginBottom:14}}>
                      <div style={{fontSize:9,fontWeight:600,letterSpacing:1.5,textTransform:"uppercase",color:C.subtle,marginBottom:8}}>
                        {lang==="es"?"Niveles Clave":"Key Levels"}
                      </div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        {signal.keyLevels.map((lv,i) => (
                          <span key={i} style={{padding:"3px 12px",background:C.accentBg,border:`1px solid ${C.border}`,borderRadius:20,fontSize:11,fontFamily:"'DM Mono'",color:C.text}}>
                            {lv}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Leverage rationale */}
                  <div style={{background:C.accentBg,borderRadius:9,padding:"12px 16px",marginBottom:12,border:`1px solid ${C.accent}30`}}>
                    <div style={{fontSize:9,fontWeight:600,letterSpacing:1.5,textTransform:"uppercase",color:C.accent,marginBottom:5}}>
                      {lang==="es"?"Justificación Apalancamiento":"Leverage Rationale"} — {signal.leverage}x
                    </div>
                    <p style={{fontSize:12.5,color:C.text,lineHeight:1.65}}>{signal.leverageRationale}</p>
                  </div>

                  {/* Learning note */}
                  {signal.learningNote && (
                    <div style={{background:`${C.long}0d`,borderRadius:9,padding:"12px 16px",marginBottom:12,border:`1px solid ${C.long}28`}}>
                      <div style={{fontSize:9,fontWeight:600,letterSpacing:1.5,textTransform:"uppercase",color:C.long,marginBottom:5}}>
                        {lang==="es"?"Aprendizaje del Agente":"Agent Learning"}
                      </div>
                      <p style={{fontSize:12.5,color:C.text,lineHeight:1.65}}>{signal.learningNote}</p>
                    </div>
                  )}

                  {/* Warning */}
                  {signal.warning && (
                    <div style={{borderTop:`1px solid ${C.border}`,paddingTop:14,display:"flex",gap:9,alignItems:"flex-start",marginBottom:14}}>
                      <span style={{color:C.wait,fontSize:15,flexShrink:0}}>⚠</span>
                      <p style={{fontSize:12.5,color:C.subtle,lineHeight:1.65}}>{signal.warning}</p>
                    </div>
                  )}

                  {/* Disclaimer */}
                  <div style={{padding:"10px 14px",background:`${C.short}08`,border:`1px solid ${C.short}20`,borderRadius:8,fontSize:10,color:C.subtle,lineHeight:1.65}}>
                    ⚠ {lang==="es"
                      ?"Las señales de ARIA son únicamente informativas. No constituyen asesoría financiera. El trading con apalancamiento conlleva riesgo significativo de pérdida de capital."
                      :"ARIA signals are for informational purposes only. Not financial advice. Leveraged trading carries significant risk of capital loss."}
                  </div>
                </div>
              )}

              {/* API Keys setup instructions */}
              {noKeys && (
                <div style={{marginTop:24,background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"22px 24px",boxShadow:C.card2}}>
                  <div style={{fontSize:11,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",color:C.accent,marginBottom:14}}>
                    🔑 {lang==="es"?"Configurar API Keys":"Setup API Keys"}
                  </div>
                  <div style={{fontSize:13,color:C.text,lineHeight:1.8}}>
                    <p style={{marginBottom:12}}>
                      {lang==="es"
                        ?"Para activar datos reales y señales IA, crea el archivo "
                        :"To enable real data and AI signals, create the file "}
                      <code style={{fontFamily:"'DM Mono'",background:C.bg,padding:"1px 8px",borderRadius:4,fontSize:12}}>
                        .env
                      </code>
                      {lang==="es"?" en la carpeta del proyecto con este contenido:":" in the project folder with this content:"}
                    </p>
                    <pre style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:8,padding:"14px 16px",fontSize:12,fontFamily:"'DM Mono'",color:C.heading,marginBottom:12,overflowX:"auto"}}>
{`REACT_APP_ANTHROPIC_KEY=sk-ant-api03-...
REACT_APP_FINNHUB_KEY=tu_key_de_finnhub`}
                    </pre>
                    <p style={{marginBottom:6,fontWeight:600,color:C.heading}}>{lang==="es"?"¿Dónde obtener las keys?":"Where to get the keys?"}</p>
                    <p>• <strong>Anthropic:</strong> <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" style={{color:C.accent}}>console.anthropic.com</a> → API Keys → Create Key</p>
                    <p>• <strong>Finnhub:</strong> <a href="https://finnhub.io" target="_blank" rel="noreferrer" style={{color:C.accent}}>finnhub.io</a> → Get free API key (gratis)</p>
                    <p style={{marginTop:12,fontSize:11,color:C.subtle}}>
                      {lang==="es"
                        ?"Después de crear el .env, ejecuta npm run build y vuelve a subir la carpeta build a Netlify."
                        :"After creating the .env, run npm run build and re-upload the build folder to Netlify."}
                    </p>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── NEWS TAB ── */}
          {tab==="news" && (
            <div className="fade">
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:10}}>
                <div>
                  <h2 style={{fontFamily:"'Libre Baskerville'",fontSize:20,fontWeight:700,color:C.heading,marginBottom:4}}>
                    {lang==="es"?"Noticias Globales en Vivo":"Live Global News"}
                  </h2>
                  <p style={{fontSize:12,color:C.subtle}}>
                    {lang==="es"?"Fuente: Finnhub · Actualización automática":"Source: Finnhub · Auto-refresh"}
                  </p>
                </div>
                <button className="hbtn" onClick={loadNews}
                  style={{padding:"7px 14px",fontSize:12,color:C.text,border:`1px solid ${C.border}`,borderRadius:8,background:C.card}}>
                  {newsLoading ? <span className="spin" style={{display:"inline-block"}}>⟳</span> : "⟳"} {lang==="es"?"Actualizar":"Refresh"}
                </button>
              </div>

              {!FINNHUB_KEY ? (
                <div style={{background:`${C.short}0a`,border:`1px solid ${C.short}30`,borderRadius:10,padding:"18px 20px",color:C.short,fontSize:13}}>
                  ⚠ {lang==="es"?"Configura la API key de Finnhub para ver noticias en vivo.":"Set up your Finnhub API key to see live news."}
                </div>
              ) : newsLoading ? (
                <div style={{display:"flex",alignItems:"center",gap:12,padding:"24px 0",color:C.subtle}}>
                  <div className="spin" style={{width:16,height:16,border:`2px solid ${C.border}`,borderTopColor:C.accent,borderRadius:"50%"}}/>
                  {lang==="es"?"Cargando noticias…":"Loading news…"}
                </div>
              ) : news.length===0 ? (
                <div style={{textAlign:"center",padding:"40px",color:C.subtle}}>
                  {lang==="es"?"No hay noticias disponibles.":"No news available."}
                </div>
              ) : (
                <div style={{display:"grid",gap:12}}>
                  {news.map((n,i) => (
                    <a key={i} href={n.url} target="_blank" rel="noreferrer" style={{textDecoration:"none"}}>
                      <div className="news-card" style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:"16px 20px",boxShadow:C.card2,transition:"all 0.15s"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8,gap:12}}>
                          <div style={{fontSize:9,fontWeight:600,letterSpacing:1,textTransform:"uppercase",color:C.accent}}>{n.source}</div>
                          <div style={{fontSize:9,color:C.subtle,fontFamily:"'DM Mono'",whiteSpace:"nowrap"}}>{n.datetime}</div>
                        </div>
                        <h3 style={{fontFamily:"'Libre Baskerville'",fontSize:14,fontWeight:700,color:C.heading,lineHeight:1.4,marginBottom:8}}>{n.headline}</h3>
                        {n.summary && <p style={{fontSize:12,color:C.subtle,lineHeight:1.6}}>{n.summary}</p>}
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── PORTFOLIO TAB ── */}
          {tab==="portfolio" && (
            <div className="fade">
              <h2 style={{fontFamily:"'Libre Baskerville'",fontSize:20,fontWeight:700,color:C.heading,marginBottom:6}}>
                {lang==="es"?"Portafolio":"Portfolio"}
              </h2>
              <p style={{fontSize:12.5,color:C.subtle,marginBottom:22,lineHeight:1.6}}>
                {lang==="es"?"Registro de todas las señales ARIA ejecutadas en esta sesión.":"Record of all ARIA signals executed in this session."}
              </p>

              {history.length===0 ? (
                <div style={{textAlign:"center",padding:"48px 24px"}}>
                  <div style={{fontSize:32,marginBottom:12}}>📊</div>
                  <div style={{fontFamily:"'Libre Baskerville'",fontSize:17,color:C.heading,marginBottom:8}}>
                    {lang==="es"?"Sin posiciones aún":"No positions yet"}
                  </div>
                  <p style={{fontSize:12.5,color:C.subtle}}>
                    {lang==="es"?"Ejecuta señales de ARIA para ver el historial aquí.":"Run ARIA signals to see your history here."}
                  </p>
                </div>
              ) : (
                <>
                  {/* Summary stats */}
                  <div className="kpigrid" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:20}}>
                    {[
                      {label:lang==="es"?"Total señales":"Total signals", value:history.length},
                      {label:"LONG",  value:history.filter(s=>s.signal==="LONG").length,  color:C.long},
                      {label:"SHORT", value:history.filter(s=>s.signal==="SHORT").length, color:C.short},
                      {label:"ESPERAR/WAIT", value:history.filter(s=>s.signal==="ESPERAR"||s.signal==="WAIT").length, color:C.wait},
                    ].map((k,i) => (
                      <div key={i} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 16px",boxShadow:C.card2}}>
                        <div style={{fontSize:9,color:C.subtle,letterSpacing:1,textTransform:"uppercase",marginBottom:4,fontWeight:600}}>{k.label}</div>
                        <div style={{fontFamily:"'Libre Baskerville'",fontSize:22,fontWeight:700,color:k.color||C.heading}}>{k.value}</div>
                      </div>
                    ))}
                  </div>

                  {[...history].reverse().map((s,i) => (
                    <div key={i} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:"16px 20px",boxShadow:C.card2,marginBottom:12}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10,flexWrap:"wrap",gap:8}}>
                        <div>
                          <div style={{fontSize:9,color:C.subtle,letterSpacing:1,textTransform:"uppercase",marginBottom:4}}>{s.asset} · {s.time}</div>
                          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                            <span style={{fontFamily:"'Libre Baskerville'",fontSize:18,fontWeight:700,color:sigColor(s.signal)}}>{s.signal}</span>
                            <Chip label={`${s.leverage}x`} color={C.accent} C={C}/>
                            <Chip label={`${s.confidence}% conf.`} color={sigColor(s.signal)} C={C}/>
                            {s.marketStructure && <Chip label={s.marketStructure} color={C.text} C={C}/>}
                          </div>
                        </div>
                        <div style={{textAlign:"right"}}>
                          <div style={{fontSize:9,color:C.subtle,marginBottom:2}}>{lang==="es"?"Precio entrada":"Entry price"}</div>
                          <div style={{fontFamily:"'DM Mono'",fontSize:15,fontWeight:700,color:C.heading}}>${s.priceAtSignal}</div>
                        </div>
                      </div>

                      <div style={{display:"flex",gap:16,flexWrap:"wrap",marginBottom:10}}>
                        {[
                          {label:"Entry", value:`$${fmt(s.entry,dp)}`,        color:C.accent},
                          {label:"SL",    value:`$${fmt(s.stopLoss,dp)}`,      color:C.short},
                          {label:"TP",    value:`$${fmt(s.takeProfit,dp)}`,    color:C.long},
                          {label:"R/R",   value:`1:${fmt(s.riskRewardRatio,1)}`, color:C.text},
                          {label:lang==="es"?"Pos.":"Pos.", value:`$${fmt(s.positionSize||0,0)}`, color:C.accent},
                        ].map((k,j) => (
                          <span key={j} style={{fontSize:11,color:C.subtle}}>
                            <span style={{fontWeight:600}}>{k.label}: </span>
                            <span style={{fontFamily:"'DM Mono'",color:k.color,fontWeight:600}}>{k.value}</span>
                          </span>
                        ))}
                      </div>

                      {s.hourlyOutlook && (
                        <div style={{background:C.accentBg,borderRadius:8,padding:"9px 13px",marginBottom:8,border:`1px solid ${C.accent}25`}}>
                          <div style={{fontSize:9,color:C.accent,fontWeight:600,letterSpacing:1,textTransform:"uppercase",marginBottom:3}}>
                            {lang==="es"?"Predicción horaria":"Hourly outlook"}
                          </div>
                          <p style={{fontSize:11.5,color:C.text,lineHeight:1.5}}>{s.hourlyOutlook}</p>
                        </div>
                      )}

                      <p style={{fontSize:12,color:C.subtle,lineHeight:1.5,fontStyle:"italic"}}>{s.summary?.slice(0,160)}…</p>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────
function Logo({C}) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:10}}>
      <div style={{width:30,height:30,background:C.accent,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
        <span style={{color:"#fff",fontFamily:"'Libre Baskerville'",fontWeight:700,fontSize:14}}>A</span>
      </div>
      <div>
        <div style={{fontFamily:"'Libre Baskerville'",fontWeight:700,fontSize:14,color:C.heading,letterSpacing:0.3}}>ARIA</div>
        <div style={{fontSize:9,color:C.subtle,letterSpacing:1.8,textTransform:"uppercase"}}>AI Trading Agent</div>
      </div>
    </div>
  );
}

function Card({title, children, C, extra}) {
  return (
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:"14px 18px",boxShadow:C.card2,marginBottom:14}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <span style={{fontSize:9,fontWeight:600,letterSpacing:1.5,textTransform:"uppercase",color:C.subtle}}>{title}</span>
        {extra}
      </div>
      {children}
    </div>
  );
}

function Chip({label, color, C}) {
  return (
    <span style={{padding:"3px 12px",borderRadius:6,background:`${color}15`,border:`1px solid ${color}40`,fontSize:11,fontWeight:600,color,fontFamily:"'DM Mono'"}}>
      {label}
    </span>
  );
}
