import { useState, useEffect, useRef, useCallback } from "react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

// ─── Keys ─────────────────────────────────────────────────────────────────────
const ANTHROPIC_KEY = process.env.REACT_APP_ANTHROPIC_KEY || "";
const FINNHUB_KEY   = process.env.REACT_APP_FINNHUB_KEY   || "";
const SB_URL        = "https://hjmldvsxtzchmjtywiax.supabase.co";
const SB_KEY        = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqbWxkdnN4dHpjaG1qdHl3aWF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwNDY2NjUsImV4cCI6MjA4OTYyMjY2NX0.rw7qRMIAZ4u6KZM8a75wHt441rFgtTMRNKIE-XArexY";

// ─── Supabase ─────────────────────────────────────────────────────────────────
const sbHeaders = { "apikey": SB_KEY, "Authorization": `Bearer ${SB_KEY}`, "Content-Type": "application/json", "Prefer": "return=representation" };
const sbInsert  = async (table, data) => { try { await fetch(`${SB_URL}/rest/v1/${table}`, { method:"POST", headers:sbHeaders, body:JSON.stringify(data) }); } catch(e) { console.warn("sb insert:", e); }};
const sbSelect  = async (table, qs="") => { try { const r = await fetch(`${SB_URL}/rest/v1/${table}?${qs}`, { headers:sbHeaders }); return await r.json(); } catch { return []; }};
const sbUpdate  = async (table, id, data) => { try { await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${id}`, { method:"PATCH", headers:sbHeaders, body:JSON.stringify(data) }); } catch(e) { console.warn("sb update:", e); }};

// ─── Assets ───────────────────────────────────────────────────────────────────
const ASSET_GROUPS = {
  Crypto: [
    { id:"BTCUSDT", label:"BTC/USDT", name:"Bitcoin",  icon:"₿", src:"binance" },
    { id:"ETHUSDT", label:"ETH/USDT", name:"Ethereum", icon:"Ξ", src:"binance" },
    { id:"SOLUSDT", label:"SOL/USDT", name:"Solana",   icon:"◎", src:"binance" },
  ],
  Forex: [
    { id:"EURUSD=X", label:"EUR/USD", name:"Euro/Dollar",   icon:"€", src:"yahoo" },
    { id:"GBPUSD=X", label:"GBP/USD", name:"Pound/Dollar",  icon:"£", src:"yahoo" },
    { id:"JPY=X",    label:"USD/JPY", name:"Dollar/Yen",    icon:"¥", src:"yahoo" },
  ],
  Equities: [
    { id:"SPY", label:"S&P 500", name:"S&P 500 ETF",    icon:"📈", src:"yahoo" },
    { id:"QQQ", label:"NASDAQ",  name:"Nasdaq 100 ETF", icon:"⬡",  src:"yahoo" },
  ],
  Commodities: [
    { id:"GC=F", label:"XAU/USD", name:"Gold Futures",     icon:"Au", src:"yahoo" },
    { id:"CL=F", label:"WTI Oil", name:"Crude Oil Futures", icon:"🛢", src:"yahoo" },
  ],
};
const ALL_ASSETS   = Object.values(ASSET_GROUPS).flat();
const LEVERAGE_OPS = [1,2,3,5,10,20,50];
const SIM_BASES    = { "EURUSD=X":1.085, "GBPUSD=X":1.265, "JPY=X":149.5, SPY:527, QQQ:448, "GC=F":2320, "CL=F":78.4 };

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt   = (n,d=2) => Number(n).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtTS = () => new Date().toLocaleString("es",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});
const fmtCD = s => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

// ─── Indicators ───────────────────────────────────────────────────────────────
function calcRSI(closes,p=14){
  if(closes.length<p+1)return null;
  let g=0,l=0;
  for(let i=closes.length-p;i<closes.length;i++){const d=closes[i]-closes[i-1];if(d>0)g+=d;else l-=d;}
  const ag=g/p,al=l/p;return al===0?100:100-100/(1+ag/al);
}
function ema(arr,p){const k=2/(p+1);let e=arr[0];for(let i=1;i<arr.length;i++)e=arr[i]*k+e*(1-k);return e;}
function calcMACD(closes){if(closes.length<26)return{macd:null,signal:null};const m=ema(closes.slice(-26),12)-ema(closes,26);return{macd:+m.toFixed(6),signal:+(m*0.9).toFixed(6)};}

// ─── Data fetchers ────────────────────────────────────────────────────────────
async function binanceKlines(sym){
  const r=await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1h&limit=48`);
  const d=await r.json();
  return d.map(k=>({time:new Date(k[0]).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}),open:+k[1],high:+k[2],low:+k[3],close:+k[4],volume:+k[5],value:+k[4]}));
}
async function binanceTicker(sym){
  const r=await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${sym}`);
  const t=await r.json();
  return{price:+t.lastPrice,ch24:+t.priceChangePercent,high24:+t.highPrice,low24:+t.lowPrice,vol24:+t.quoteVolume};
}
async function yahooData(sym,limit=48){
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1h&range=7d`;
  const r=await fetch(`/.netlify/functions/yahoo?symbol=${encodeURIComponent(sym)}`);
  const d=await r.json();
  const result=d?.chart?.result?.[0];
  if(!result)throw new Error("No data");
  const meta=result.meta,ts=result.timestamp,q=result.indicators.quote[0];
  const klines=ts.slice(-limit).map((t,i)=>({
    time:new Date(t*1000).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}),
    open:+(q.open[i]||0).toFixed(4),high:+(q.high[i]||0).toFixed(4),
    low:+(q.low[i]||0).toFixed(4),close:+(q.close[i]||0).toFixed(4),
    volume:q.volume[i]||0,value:+(q.close[i]||0).toFixed(4),
  })).filter(k=>k.close>0);
  const price=meta.regularMarketPrice,prev=meta.chartPreviousClose||meta.previousClose;
  return{klines,ticker:{price,ch24:prev?((price-prev)/prev)*100:0,high24:meta.regularMarketDayHigh||price*1.01,low24:meta.regularMarketDayLow||price*0.99,vol24:(meta.regularMarketVolume||0)*price}};
}
async function fetchNews(){
  try{
    const r=await fetch(`https://finnhub.io/api/v1/news?category=general&token=${FINNHUB_KEY}`);
    const d=await r.json();
    return d.slice(0,8).map(n=>({headline:n.headline,summary:n.summary?.slice(0,200)||"",source:n.source,url:n.url,datetime:new Date(n.datetime*1000).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})}));
  }catch{return[];}
}
function simKlines(base,n=48){
  let v=base;
  return Array.from({length:n},(_,i)=>{
    const o=v;v=Math.max(base*0.7,v*(1+(Math.random()-0.49)*0.006));
    const d=new Date();d.setHours(d.getHours()-(n-i));
    return{time:`${d.getHours().toString().padStart(2,"0")}:00`,open:o,high:Math.max(o,v)*1.003,low:Math.min(o,v)*0.997,close:v,volume:Math.random()*4e8+5e7,value:v};
  });
}

// ─── Colors ───────────────────────────────────────────────────────────────────
const C = dark => dark?{
  bg:"#080d18",surface:"#0e1525",card:"#111e30",border:"#192840",muted:"#1e304a",subtle:"#4a6585",text:"#b5cde0",heading:"#eaf2fa",
  accent:"#2563eb",accentBg:"rgba(37,99,235,0.11)",long:"#10b981",short:"#ef4444",wait:"#f59e0b",
  shadow:"0 4px 32px rgba(0,0,0,0.55)",card2:"0 2px 8px rgba(0,0,0,0.35)",
}:{
  bg:"#f0f4fb",surface:"#ffffff",card:"#ffffff",border:"#e0e8f4",muted:"#dce6f5",subtle:"#7a9abf",text:"#2d4a68",heading:"#091929",
  accent:"#1d4ed8",accentBg:"rgba(29,78,216,0.07)",long:"#059669",short:"#dc2626",wait:"#b45309",
  shadow:"0 4px 28px rgba(9,25,41,0.10)",card2:"0 1px 4px rgba(9,25,41,0.07)",
};

// ─── Tooltip ──────────────────────────────────────────────────────────────────
const CTip=({active,payload,label,col,isPrice,dp=2})=>{
  if(!active||!payload?.length)return null;
  return(<div style={{background:col.card,border:`1px solid ${col.border}`,borderRadius:8,padding:"8px 14px",boxShadow:col.shadow}}>
    <p style={{fontSize:10,color:col.subtle,marginBottom:2}}>{label}</p>
    <p style={{fontSize:13,fontWeight:700,color:col.heading,fontFamily:"'DM Mono'"}}>{isPrice?"$":""}{fmt(payload[0].value,isPrice?dp:0)}</p>
  </div>);
};

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App(){
  const [dark,setDark]       = useState(false);
  const [lang,setLang]       = useState("es");
  const [asset,setAsset]     = useState(ALL_ASSETS[0]);
  const [tab,setTab]         = useState("dashboard");
  const [ticker,setTicker]   = useState(null);
  const [klines,setKlines]   = useState([]);
  const [status,setStatus]   = useState("connecting");
  const [rsi,setRsi]         = useState(null);
  const [macd,setMacd]       = useState({});
  const [signal,setSignal]   = useState(null);
  const [analyzing,setAnalyzing] = useState(false);
  const [history,setHistory] = useState([]);
  const [news,setNews]       = useState([]);
  const [newsLoading,setNewsLoading] = useState(false);
  const [capital,setCapital] = useState(1000);
  const [capInput,setCapInput] = useState("1000");
  const [leverage,setLeverage] = useState(null);
  const [autoOn,setAutoOn]   = useState(false);
  const [countdown,setCd]    = useState(3600);
  const [mobileOpen,setMobileOpen] = useState(false);
  const [dbHistory,setDbHistory] = useState([]);
  const [dbLoading,setDbLoading] = useState(false);
  const [outcomeMap,setOutcomeMap] = useState({});
  const [chatOpen,setChatOpen] = useState(false);
  const [chatMsgs,setChatMsgs] = useState([{role:"aria",text:"¡Hola! Soy ARIA. Puedes preguntarme sobre cualquier activo, comentarme resultados de operaciones o pedir análisis. ¿En qué puedo ayudarte?"}]);
  const [chatInput,setChatInput] = useState("");
  const [chatLoading,setChatLoading] = useState(false);

  const wsRef  = useRef(null);
  const cdRef  = useRef(null);
  const klRef  = useRef([]);
  const chatEndRef = useRef(null);
  const col = C(dark);

  const recompute = useCallback(kl=>{
    const closes=kl.map(k=>k.close);
    setRsi(calcRSI(closes));
    setMacd(calcMACD(closes));
  },[]);

  // ── DB ───────────────────────────────────────────────────────────────────────
  const loadDb = async()=>{
    setDbLoading(true);
    const rows=await sbSelect("signals","order=created_at.desc&limit=100");
    if(Array.isArray(rows))setDbHistory(rows);
    setDbLoading(false);
  };
  useEffect(()=>{loadDb();},[]);

  const saveSignal = async sig=>{
    await sbInsert("signals",{
      asset:sig.asset, signal:sig.signal, confidence:sig.confidence,
      leverage:sig.leverage, entry:sig.entry, stop_loss:sig.stopLoss,
      take_profit:sig.takeProfit, risk_reward:sig.riskRewardRatio,
      price_at_signal:sig.priceAtSignal, market_structure:sig.marketStructure,
      summary:sig.summary, news_impact:sig.newsImpact||null, outcome:"pending",
    });
    loadDb();
  };

  const updateOutcome = async(id,outcome)=>{
    await sbUpdate("signals",id,{outcome});
    setOutcomeMap(prev=>({...prev,[id]:outcome}));
    loadDb();
  };

  const saveChat = async(role,content)=>{
    await sbInsert("chat_messages",{role,content,asset:asset.label});
  };

  // ── Market data ───────────────────────────────────────────────────────────────
  const stopWs = ()=>{
    if(wsRef.current){
      if(wsRef.current._sim)clearInterval(wsRef.current._iv);
      else try{wsRef.current.close(1000);}catch{}
      wsRef.current=null;
    }
  };

  const startSim = a=>{
    const base=SIM_BASES[a.id]||100;
    const kl=simKlines(base);
    klRef.current=kl;setKlines(kl);
    const p=base*(1+(Math.random()-0.5)*0.008);
    setTicker({price:p,ch24:(Math.random()-0.45)*2,high24:p*1.01,low24:p*0.99,vol24:p*1e6});
    recompute(kl);setStatus("sim");
    const iv=setInterval(()=>{
      const p2=base*(1+(Math.random()-0.5)*0.008);
      setTicker({price:p2,ch24:(Math.random()-0.45)*2,high24:p2*1.01,low24:p2*0.99,vol24:p2*1e6});
    },5000);
    wsRef.current={_sim:true,_iv:iv};
  };

  const loadMarket = useCallback(async a=>{
    stopWs();
    setStatus("connecting");setKlines([]);setTicker(null);klRef.current=[];

    if(a.src==="binance"){
      try{
        const[kl,tk]=await Promise.all([binanceKlines(a.id),binanceTicker(a.id)]);
        klRef.current=kl;setKlines(kl);setTicker(tk);recompute(kl);setStatus("live");
        const sym=a.id.toLowerCase();
        const ws=new WebSocket(`wss://stream.binance.com:9443/ws/${sym}@miniTicker/${sym}@kline_1h`);
        ws.onopen=()=>setStatus("live");
        ws.onerror=()=>setStatus("error");
        ws.onmessage=evt=>{
          try{
            const msg=JSON.parse(evt.data);
            if(msg.e==="24hrMiniTicker")setTicker(prev=>prev?({...prev,price:+msg.c,ch24:((+msg.c-+msg.o)/+msg.o)*100,high24:+msg.h,low24:+msg.l,vol24:+msg.q}):null);
            if(msg.e==="kline"){
              const k=msg.k;
              const bar={time:new Date(k.t).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}),open:+k.o,high:+k.h,low:+k.l,close:+k.c,volume:+k.v,value:+k.c};
              klRef.current=klRef.current.at(-1)?.time===bar.time?[...klRef.current.slice(0,-1),bar]:[...klRef.current.slice(-47),bar];
              setKlines([...klRef.current]);recompute(klRef.current);
            }
          }catch{}
        };
        wsRef.current=ws;
      }catch{setStatus("error");}
    } else if(a.src==="yahoo"){
      try{
        const{klines:kl,ticker:tk}=await yahooData(a.id);
        klRef.current=kl;setKlines(kl);setTicker(tk);recompute(kl);setStatus("live");
        const iv=setInterval(async()=>{try{const{ticker:tk2}=await yahooData(a.id,1);setTicker(tk2);}catch{}},60000);
        wsRef.current={_sim:true,_iv:iv};
      }catch{startSim(a);}
    } else {startSim(a);}
  },[recompute]);

  useEffect(()=>{loadMarket(asset);return stopWs;},[asset]);// eslint-disable-line

  // ── News ──────────────────────────────────────────────────────────────────────
  const loadNews=useCallback(async()=>{setNewsLoading(true);const n=await fetchNews();setNews(n);setNewsLoading(false);},[]);
  useEffect(()=>{loadNews();},[loadNews]);

  // ── Auto countdown ─────────────────────────────────────────────────────────
  useEffect(()=>{
    clearInterval(cdRef.current);
    if(!autoOn){setCd(3600);return;}
    setCd(3600);
    cdRef.current=setInterval(()=>setCd(n=>{if(n<=1){runSignal();return 3600;}return n-1;}),1000);
    return()=>clearInterval(cdRef.current);
  },[autoOn,asset]);// eslint-disable-line

  // ── AI Signal ─────────────────────────────────────────────────────────────
  const runSignal=async()=>{
    if(!ticker||!ANTHROPIC_KEY)return;
    setAnalyzing(true);setSignal(null);
    const{price,ch24,high24,low24}=ticker;
    const closes=klines.map(k=>k.close);
    const vols=klines.map(k=>k.volume);
    const avgVol=vols.reduce((a,b)=>a+b,0)/(vols.length||1);
    const volRatio=((vols.at(-1)||0)/avgVol).toFixed(2);
    const dp=price>100?2:price>1?4:6;
    const histCtx=history.slice(-5).map(s=>`[${s.time}] ${s.signal} @$${s.priceAtSignal} conf:${s.confidence}%`).join("\n")||"Sin señales previas.";
    const newsCtx=news.slice(0,5).map(n=>`- [${n.datetime}] ${n.source}: ${n.headline}`).join("\n")||"Sin noticias.";

    const prompt=`Eres ARIA, agente cuantitativo de trading IA. Analiza ${asset.label} (${asset.name}) y genera señal horaria.

DATOS REALES:
- Precio: $${fmt(price,dp)} | Cambio 24h: ${ch24>=0?"+":""}${ch24.toFixed(2)}%
- Máx/Mín 24h: $${fmt(high24,dp)} / $${fmt(low24,dp)}
- RSI(14): ${rsi?rsi.toFixed(2):"N/D"} ${rsi>70?"⚠SOBRECOMPRADO":rsi<30?"⚠SOBREVENDIDO":""}
- MACD: ${macd.macd??"N/D"} | Señal: ${macd.signal??"N/D"}
- Ratio volumen: ${volRatio}x vs media 48h
- Rango 48h: $${closes.length?fmt(Math.min(...closes),dp):"N/D"} - $${closes.length?fmt(Math.max(...closes),dp):"N/D"}
- Capital: $${fmt(capital,2)} | Apalancamiento máx: 50x

NOTICIAS EN VIVO:
${newsCtx}

HISTORIAL (aprendizaje):
${histCtx}

Responde SOLO con JSON válido sin backticks:
{"signal":"LONG"|"SHORT"|"ESPERAR","confidence":<40-95>,"leverage":<de [1,2,3,5,10,20,50]>,"leverageRationale":"<por qué>","entry":<precio>,"stopLoss":<precio>,"takeProfit":<precio>,"riskRewardRatio":<número>,"capitalToRisk":<1-10>,"positionSize":<capital*leverage*capitalToRisk/100>,"summary":"<3 oraciones>","technicalBasis":"<RSI,MACD,volumen>","newsImpact":"<impacto noticias>","trendAnalysis":"<tendencia horaria>","keyLevels":["<s1>","<s2>","<r1>"],"marketStructure":"alcista"|"bajista"|"lateral","hourlyOutlook":"<próximas 3h>","learningNote":"<aprendizaje>","warning":"<riesgo>","timeframe":"1H"}`;

    try{
      const res=await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",
        headers:{"Content-Type":"application/json","x-api-key":ANTHROPIC_KEY,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
        body:JSON.stringify({model:"claude-haiku-4-5-20251001",max_tokens:1200,messages:[{role:"user",content:prompt}]}),
      });
      const data=await res.json();
      if(data.error)throw new Error(data.error.message);
      const raw=data.content?.map(b=>b.text||"").join("")||"";
      const parsed=JSON.parse(raw.replace(/```json|```/g,"").trim());
      const dp2=price>100?2:price>1?4:6;
      const entry={...parsed,priceAtSignal:fmt(price,dp2),time:fmtTS(),asset:asset.label};
      setSignal(entry);setLeverage(parsed.leverage);
      setHistory(prev=>[...prev.slice(-19),entry]);
      saveSignal(entry);
    }catch(e){setSignal({error:true,msg:e.message?.includes("401")?"invalid-key":"general"});}
    setAnalyzing(false);
  };

  // ── Chat ──────────────────────────────────────────────────────────────────────
  const sendChat=async()=>{
    if(!chatInput.trim()||chatLoading)return;
    if(!ANTHROPIC_KEY){setChatMsgs(prev=>[...prev,{role:"user",text:chatInput},{role:"aria",text:"⚠ Necesitas configurar tu API key de Anthropic."}]);setChatInput("");return;}
    const userMsg=chatInput.trim();
    setChatMsgs(prev=>[...prev,{role:"user",text:userMsg}]);
    setChatInput("");setChatLoading(true);
    saveChat("user",userMsg);
    const dp=ticker?.price>100?2:ticker?.price>1?4:6;
    const sys=`Eres ARIA, agente experta en trading cuantitativo con IA. Contexto actual:
- Activo: ${asset.label} | Precio: $${ticker?fmt(ticker.price,dp):"N/D"} | Cambio 24h: ${ticker?ticker.ch24.toFixed(2)+"%":"N/D"}
- RSI: ${rsi?rsi.toFixed(1):"N/D"} | MACD: ${macd.macd??"N/D"}
- Última señal: ${history.length?`${history.at(-1).signal} @$${history.at(-1).priceAtSignal} (${history.at(-1).confidence}% conf.)`:"Sin señales"}
- Total señales sesión: ${history.length}
- Señales en DB: ${dbHistory.length}
- Noticias: ${news.slice(0,3).map(n=>n.headline).join(" | ")||"Sin noticias"}
Responde conciso y profesional. Máx 4 oraciones salvo que pidan más. Usa emojis ocasionalmente.`;
    const msgs=chatMsgs.slice(-8).map(m=>({role:m.role==="aria"?"assistant":"user",content:m.text}));
    msgs.push({role:"user",content:userMsg});
    try{
      const res=await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",
        headers:{"Content-Type":"application/json","x-api-key":ANTHROPIC_KEY,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
        body:JSON.stringify({model:"claude-haiku-4-5-20251001",max_tokens:400,system:sys,messages:msgs}),
      });
      const data=await res.json();
      const reply=data.content?.map(b=>b.text||"").join("")||"No pude procesar tu mensaje.";
      setChatMsgs(prev=>[...prev,{role:"aria",text:reply}]);
      saveChat("aria",reply);
    }catch{setChatMsgs(prev=>[...prev,{role:"aria",text:"⚠ Error de conexión."}]);}
    setChatLoading(false);
    setTimeout(()=>chatEndRef.current?.scrollIntoView({behavior:"smooth"}),100);
  };

  // ── Computed ──────────────────────────────────────────────────────────────────
  const price =ticker?.price??0;
  const ch24  =ticker?.ch24??0;
  const isUp  =ch24>=0;
  const dp    =price>100?2:price>1?4:6;
  const sigColor=s=>!s?col.accent:s==="LONG"?col.long:s==="SHORT"?col.short:col.wait;
  const statusLabel={connecting:"Conectando…",live:"EN VIVO",sim:"Simulado",error:"Error"}[status]||"…";
  const statusColor={connecting:col.wait,live:col.long,sim:col.subtle,error:col.short}[status]||col.subtle;

  // ─── Sidebar content ──────────────────────────────────────────────────────────
  const SidebarContent=()=>(
    <>
      <div style={{padding:"14px 14px 10px",borderBottom:`1px solid ${col.border}`}}>
        <div style={{fontSize:9,fontWeight:600,letterSpacing:1.5,textTransform:"uppercase",color:col.subtle,marginBottom:12}}>{lang==="es"?"Activos":"Assets"}</div>
        {Object.entries(ASSET_GROUPS).map(([group,items])=>(
          <div key={group} style={{marginBottom:14}}>
            <div style={{fontSize:9,color:col.subtle,letterSpacing:1.2,textTransform:"uppercase",marginBottom:6,fontWeight:600}}>{group}</div>
            {items.map(a=>(
              <div key={a.id} className="mcard" onClick={()=>{setAsset(a);setSignal(null);setMobileOpen(false);}}
                style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 10px",borderRadius:8,marginBottom:3,cursor:"pointer",background:asset.id===a.id?col.accentBg:"transparent",border:`1px solid ${asset.id===a.id?col.accent:"transparent"}`,transition:"all 0.15s"}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:13}}>{a.icon}</span>
                  <div>
                    <div style={{fontSize:12,fontWeight:600,color:asset.id===a.id?col.accent:col.heading}}>{a.label}</div>
                    <div style={{fontSize:9,color:col.subtle}}>{a.name}</div>
                  </div>
                </div>
                {asset.id===a.id&&<div style={{width:4,height:4,borderRadius:"50%",background:col.accent}} className="pulse"/>}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div style={{padding:"12px 14px 8px",borderBottom:`1px solid ${col.border}`}}>
        <div style={{fontSize:9,fontWeight:600,letterSpacing:1.5,textTransform:"uppercase",color:col.subtle,marginBottom:4}}>{lang==="es"?"Historial":"Signal History"}</div>
        <div style={{fontSize:10,color:col.subtle}}>{history.length} {lang==="es"?"señales esta sesión":"signals this session"}</div>
      </div>
      {history.length===0?(
        <div style={{padding:"20px 16px",fontSize:11,color:col.subtle,textAlign:"center",lineHeight:1.7}}>{lang==="es"?"Sin señales aún.":"No signals yet."}</div>
      ):[...history].reverse().map((s,i)=>(
        <div key={i} style={{padding:"10px 14px",borderBottom:`1px solid ${col.border}`}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
            <span style={{fontSize:11,fontWeight:700,color:sigColor(s.signal),fontFamily:"'DM Mono'"}}>{s.signal}</span>
            <span style={{fontSize:9,color:col.subtle,fontFamily:"'DM Mono'"}}>{s.leverage}x</span>
          </div>
          <div style={{fontSize:10,color:col.text,marginBottom:1}}>{s.asset}</div>
          <div style={{fontSize:9,color:col.subtle,fontFamily:"'DM Mono'",marginBottom:4}}>${s.priceAtSignal}</div>
          <div style={{height:2,background:col.muted,borderRadius:1}}>
            <div style={{height:"100%",width:`${s.confidence}%`,background:sigColor(s.signal),borderRadius:1}}/>
          </div>
          <div style={{fontSize:9,color:col.subtle,marginTop:2}}>{s.confidence}% conf.</div>
        </div>
      ))}
    </>
  );

  const TABS=[
    ["dashboard", lang==="es"?"Panel":"Dashboard"],
    ["news",      lang==="es"?"Noticias":"News"],
    ["history",   lang==="es"?"Historial DB":"DB History"],
    ["portfolio", lang==="es"?"Portafolio":"Portfolio"],
  ];

  return(
    <div style={{fontFamily:"'DM Sans',sans-serif",background:col.bg,minHeight:"100dvh",color:col.text,transition:"background 0.25s,color 0.25s"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&family=DM+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:3px;}::-webkit-scrollbar-thumb{background:${col.muted};border-radius:3px;}
        button,input{font-family:inherit;}input:focus{outline:none;}
        .mcard{transition:all 0.15s;cursor:pointer;}.mcard:hover{background:${col.accentBg}!important;}
        .hbtn{transition:opacity 0.15s;cursor:pointer;background:none;border:none;}.hbtn:hover{opacity:0.7;}
        .aibtn{transition:all 0.2s;cursor:pointer;border:none;font-family:inherit;}
        .aibtn:hover:not(:disabled){filter:brightness(1.08);transform:translateY(-1px);}
        .aibtn:disabled{opacity:0.5;cursor:not-allowed;}
        .levbtn{transition:all 0.15s;cursor:pointer;border:none;font-family:'DM Mono',monospace;}.levbtn:hover{filter:brightness(1.1);}
        .ntab{background:none;border:none;cursor:pointer;transition:all 0.15s;}
        .fade{animation:fu 0.3s ease both;}@keyframes fu{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        .pulse{animation:pl 2s ease-in-out infinite;}@keyframes pl{0%,100%{opacity:1}50%{opacity:0.2}}
        .blink{animation:bl 1s step-end infinite;}@keyframes bl{0%,100%{opacity:1}50%{opacity:0}}
        .spin{animation:sp 1s linear infinite;}@keyframes sp{to{transform:rotate(360deg)}}
        .moverlay{position:fixed;inset:0;z-index:200;overflow-y:auto;}
        @media(max-width:820px){
          .dsidebar{display:none!important;}
          .mobham{display:flex!important;}
          .main{padding:16px!important;padding-bottom:calc(80px + env(safe-area-inset-bottom))!important;}
          .floatbtn{bottom:calc(24px + env(safe-area-inset-bottom))!important;}
          .chatpanel{bottom:calc(88px + env(safe-area-inset-bottom))!important;}
          .kpigrid{grid-template-columns:1fr 1fr!important;}
          .chartgrid{grid-template-columns:1fr!important;}
          .siggrid{grid-template-columns:1fr 1fr!important;}
          .levrow{flex-wrap:wrap!important;}
        }
        @media(max-width:500px){.kpigrid{grid-template-columns:1fr!important;}.siggrid{grid-template-columns:1fr!important;}}
      `}</style>

      {/* Mobile overlay */}
      {mobileOpen&&(
        <div className="moverlay" style={{background:col.surface}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 16px",borderBottom:`1px solid ${col.border}`}}>
            <Logo col={col}/>
            <button className="hbtn" onClick={()=>setMobileOpen(false)} style={{fontSize:20,color:col.subtle}}>✕</button>
          </div>
          <SidebarContent/>
        </div>
      )}

      {/* Header */}
      <header style={{background:col.surface,borderBottom:`1px solid ${col.border}`,position:"sticky",top:0,zIndex:100,boxShadow:col.card2,paddingTop:"env(safe-area-inset-top)"}}>
        <div style={{height:56,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 14px",gap:8}}>
          <Logo col={col}/>
          {/* Scrollable nav */}
          <div style={{display:"flex",alignItems:"center",gap:4,overflowX:"auto",WebkitOverflowScrolling:"touch",scrollbarWidth:"none",msOverflowStyle:"none",flex:1,minWidth:0}}>
            <style>{`div::-webkit-scrollbar{display:none}`}</style>
            {TABS.map(([key,label])=>(
              <button key={key} className="ntab" onClick={()=>setTab(key)}
                style={{padding:"5px 10px",fontSize:12,fontWeight:tab===key?600:400,color:tab===key?col.accent:col.subtle,background:tab===key?col.accentBg:"transparent",borderRadius:6,whiteSpace:"nowrap",flexShrink:0}}>
                {label}
              </button>
            ))}
            <div style={{width:1,height:18,background:col.border,flexShrink:0,marginLeft:2}}/>
            <div style={{display:"flex",alignItems:"center",gap:4,flexShrink:0}}>
              <div style={{width:5,height:5,borderRadius:"50%",background:statusColor}} className={status==="live"?"pulse":""}/>
              <span style={{fontSize:9,color:statusColor,fontFamily:"'DM Mono'",letterSpacing:0.8,whiteSpace:"nowrap"}}>{statusLabel}</span>
            </div>
            <button className="hbtn" onClick={()=>setLang(l=>l==="es"?"en":"es")}
              style={{padding:"3px 8px",fontSize:11,fontWeight:600,color:col.accent,border:`1px solid ${col.border}`,borderRadius:6,flexShrink:0}}>
              {lang==="es"?"EN":"ES"}
            </button>
            <button className="hbtn" onClick={()=>setDark(d=>!d)}
              style={{padding:"3px 8px",fontSize:11,color:col.text,border:`1px solid ${col.border}`,borderRadius:6,flexShrink:0}}>
              {dark?"☀":"◑"}
            </button>
          </div>
          <button className="hbtn mobham" onClick={()=>setMobileOpen(true)}
            style={{fontSize:20,color:col.text,display:"none",alignItems:"center",padding:"0 2px",flexShrink:0}}>☰</button>
        </div>
      </header>

      {/* Body */}
      <div style={{display:"flex",height:"calc(100dvh - 56px - env(safe-area-inset-top))"}}>
        <aside className="dsidebar" style={{width:252,borderRight:`1px solid ${col.border}`,overflowY:"auto",background:col.surface,flexShrink:0}}>
          <SidebarContent/>
        </aside>

        <main className="main" style={{flex:1,overflowY:"auto",padding:"24px 26px",paddingBottom:"calc(80px + env(safe-area-inset-bottom))"}}>

          {/* ── DASHBOARD ── */}
          {tab==="dashboard"&&(
            <>
              <div style={{marginBottom:22}}>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8,flexWrap:"wrap"}}>
                  <span style={{fontSize:22}}>{asset.icon}</span>
                  <div>
                    <div style={{fontSize:10,color:col.subtle,letterSpacing:1.5,textTransform:"uppercase",fontWeight:600,marginBottom:2}}>
                      {asset.name} · {status==="live"?(asset.src==="binance"?"Binance WS":"Yahoo Finance"):status==="sim"?"Simulado":"Conectando…"}
                    </div>
                    <div style={{fontFamily:"'Libre Baskerville'",fontWeight:700,fontSize:"clamp(26px,4vw,40px)",color:col.heading,letterSpacing:-0.5,lineHeight:1.1}}>
                      {!ticker?"—":"$"+fmt(price,dp)}
                    </div>
                  </div>
                  {ticker&&<div style={{paddingBottom:4}}>
                    <span style={{fontFamily:"'DM Mono'",fontSize:15,fontWeight:600,color:isUp?col.long:col.short}}>{isUp?"+":""}{ch24.toFixed(2)}%</span>
                    <span style={{fontSize:10,color:col.subtle,marginLeft:6}}>24h</span>
                  </div>}
                  <button className="hbtn" onClick={()=>loadMarket(asset)} style={{marginLeft:"auto",fontSize:12,color:col.subtle,border:`1px solid ${col.border}`,borderRadius:6,padding:"4px 12px"}}>⟳</button>
                </div>

                {ticker&&(
                  <div className="kpigrid" style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:20}}>
                    {[
                      {label:lang==="es"?"Máx 24h":"24h High",value:`$${fmt(ticker.high24,dp)}`,color:col.long},
                      {label:lang==="es"?"Mín 24h":"24h Low", value:`$${fmt(ticker.low24,dp)}`, color:col.short},
                      {label:lang==="es"?"Volumen":"Volume",   value:`$${fmt(ticker.vol24/1e6,1)}M`,color:col.text},
                      {label:"RSI (14)",value:rsi?rsi.toFixed(1):"—",color:rsi>70?col.short:rsi<30?col.long:col.text},
                      {label:"MACD",   value:macd.macd!=null?(macd.macd>0?"+":"")+macd.macd.toFixed(4):"—",color:macd.macd>0?col.long:col.short},
                    ].map((k,i)=>(
                      <div key={i} style={{background:col.card,border:`1px solid ${col.border}`,borderRadius:10,padding:"10px 14px",boxShadow:col.card2}}>
                        <div style={{fontSize:9,color:col.subtle,letterSpacing:1,textTransform:"uppercase",marginBottom:3,fontWeight:600}}>{k.label}</div>
                        <div style={{fontFamily:"'DM Mono'",fontSize:14,fontWeight:700,color:k.color}}>{k.value}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {klines.length>0&&(
                <div className="chartgrid" style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:14,marginBottom:16}}>
                  <Card title={`${asset.label} · 1H · ${klines.length} ${lang==="es"?"velas":"candles"}`} col={col}>
                    <ResponsiveContainer width="100%" height={165}>
                      <AreaChart data={klines} margin={{top:4,right:8,bottom:0,left:-14}}>
                        <defs>
                          <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={isUp?col.long:col.short} stopOpacity={dark?0.28:0.18}/>
                            <stop offset="100%" stopColor={isUp?col.long:col.short} stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="2 5" stroke={col.border} vertical={false}/>
                        <XAxis dataKey="time" tick={{fontSize:8,fill:col.subtle}} tickLine={false} interval={Math.floor(klines.length/6)}/>
                        <YAxis domain={["auto","auto"]} tick={{fontSize:8,fill:col.subtle}} tickLine={false} tickFormatter={v=>"$"+(v>=1000?fmt(v,0):fmt(v,dp>2?dp:2))} width={64}/>
                        <Tooltip content={<CTip col={col} isPrice dp={dp}/>}/>
                        {signal?.entry&&<ReferenceLine y={signal.entry} stroke={col.accent} strokeDasharray="4 3" strokeWidth={1} label={{value:"Entry",fill:col.accent,fontSize:8,position:"right"}}/>}
                        {signal?.stopLoss&&<ReferenceLine y={signal.stopLoss} stroke={col.short} strokeDasharray="3 3" strokeWidth={1} label={{value:"SL",fill:col.short,fontSize:8,position:"right"}}/>}
                        {signal?.takeProfit&&<ReferenceLine y={signal.takeProfit} stroke={col.long} strokeDasharray="3 3" strokeWidth={1} label={{value:"TP",fill:col.long,fontSize:8,position:"right"}}/>}
                        <Area type="monotone" dataKey="close" stroke={isUp?col.long:col.short} strokeWidth={1.8} fill="url(#pg)" dot={false}/>
                      </AreaChart>
                    </ResponsiveContainer>
                  </Card>
                  <Card title={lang==="es"?"Volumen":"Volume"} col={col}>
                    <ResponsiveContainer width="100%" height={165}>
                      <BarChart data={klines.slice(-20)} margin={{top:4,right:4,bottom:0,left:-26}}>
                        <CartesianGrid strokeDasharray="2 5" stroke={col.border} vertical={false}/>
                        <XAxis dataKey="time" tick={{fontSize:8,fill:col.subtle}} tickLine={false} interval={4}/>
                        <YAxis tick={{fontSize:8,fill:col.subtle}} tickLine={false} tickFormatter={v=>(v/1e6).toFixed(0)+"M"}/>
                        <Tooltip content={<CTip col={col}/>}/>
                        <Bar dataKey="volume" fill={col.accentBg} stroke={col.accent} strokeWidth={0.8} radius={[2,2,0,0]}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </Card>
                </div>
              )}

              {/* Capital */}
              <Card title={lang==="es"?"Capital y Apalancamiento":"Capital & Leverage"} col={col}>
                <div style={{display:"flex",gap:24,flexWrap:"wrap",alignItems:"flex-start"}}>
                  <div style={{minWidth:180}}>
                    <div style={{fontSize:10,color:col.subtle,marginBottom:6,fontWeight:500}}>Capital (USD)</div>
                    <div style={{display:"flex",alignItems:"center",background:col.bg,border:`1px solid ${col.border}`,borderRadius:8,overflow:"hidden"}}>
                      <span style={{padding:"0 12px",fontSize:15,color:col.subtle,fontFamily:"'DM Mono'"}}>$</span>
                      <input type="number" value={capInput} min="1" onChange={e=>setCapInput(e.target.value)} onBlur={()=>{const v=parseFloat(capInput);if(!isNaN(v)&&v>0)setCapital(v);}}
                        style={{flex:1,background:"transparent",border:"none",padding:"10px 10px 10px 0",fontSize:15,fontFamily:"'DM Mono'",fontWeight:700,color:col.heading}}/>
                    </div>
                    {leverage&&(
                      <div style={{marginTop:7,fontSize:11,color:col.subtle,lineHeight:1.7}}>
                        <span style={{color:col.text}}>{lang==="es"?"Posición: ":"Position: "}</span><span style={{fontFamily:"'DM Mono'",color:col.accent,fontWeight:700}}>${fmt(capital*leverage,0)}</span><br/>
                        <span style={{color:col.text}}>{lang==="es"?"Pérd. máx: ":"Max loss: "}</span><span style={{fontFamily:"'DM Mono'",color:col.short,fontWeight:700}}>${fmt(capital,0)}</span>
                        {leverage>=20&&<><br/><span style={{color:col.short,fontWeight:700}}>⚠ Alto riesgo</span></>}
                      </div>
                    )}
                  </div>
                  <div style={{flex:1,minWidth:240}}>
                    <div style={{fontSize:10,color:col.subtle,marginBottom:6,fontWeight:500}}>
                      {lang==="es"?"Apalancamiento":"Leverage"}
                      {signal?.leverage&&<span style={{marginLeft:8,color:col.long,fontWeight:600,fontSize:10}}>← IA recomienda {signal.leverage}x</span>}
                    </div>
                    <div className="levrow" style={{display:"flex",gap:6}}>
                      {LEVERAGE_OPS.map(l=>{
                        const isAI=signal?.leverage===l,isSel=leverage===l;
                        return(<button key={l} className="levbtn" onClick={()=>setLeverage(l)}
                          style={{flex:1,minWidth:36,padding:"8px 0",fontSize:11,fontWeight:700,borderRadius:8,
                            background:isSel?(isAI?col.long:col.accent):isAI?`${col.long}18`:col.bg,
                            color:isSel?"#fff":isAI?col.long:col.subtle,
                            border:`1.5px solid ${isSel?(isAI?col.long:col.accent):isAI?col.long+"55":col.border}`}}>{l}x</button>);
                      })}
                    </div>
                  </div>
                </div>
              </Card>

              {/* AI Button */}
              <div style={{display:"flex",gap:10,margin:"14px 0",flexWrap:"wrap"}}>
                <button className="aibtn" onClick={runSignal} disabled={analyzing||!ticker}
                  style={{flex:1,minWidth:200,padding:"13px 22px",background:col.accent,borderRadius:10,color:"#fff",fontSize:13.5,fontWeight:600,boxShadow:`0 4px 18px ${col.accent}40`,display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>
                  {analyzing?<><div className="spin" style={{width:14,height:14,border:"2px solid rgba(255,255,255,0.35)",borderTopColor:"#fff",borderRadius:"50%"}}/>{lang==="es"?"ARIA Analizando…":"ARIA Analyzing…"}</>:<><span style={{fontSize:16}}>✦</span>{lang==="es"?"Ejecutar Señal ARIA":"Run ARIA Signal"}</>}
                </button>
                <button className="hbtn" onClick={()=>setAutoOn(a=>!a)}
                  style={{padding:"12px 16px",borderRadius:10,border:`1.5px solid ${autoOn?col.long:col.border}`,background:autoOn?`${col.long}12`:col.card,color:autoOn?col.long:col.subtle,fontSize:12,fontWeight:600,cursor:"pointer"}}>
                  {autoOn?<><span className="blink">●</span> Auto {fmtCD(countdown)}</>:<>⏱ {lang==="es"?"Auto Horario":"Hourly Auto"}</>}
                </button>
              </div>

              {signal?.error&&(
                <div style={{marginBottom:16,background:`${col.short}0a`,border:`1px solid ${col.short}30`,borderRadius:10,padding:"14px 18px",color:col.short,fontSize:13}}>
                  {signal.msg==="invalid-key"?"⚠ API key inválida.":"⚠ Error al generar señal. Verifica tu conexión."}
                </div>
              )}

              {signal&&!signal.error&&(
                <div className="fade" style={{background:col.card,border:`1.5px solid ${sigColor(signal.signal)}40`,borderRadius:14,padding:"22px 24px",boxShadow:col.shadow}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:18,flexWrap:"wrap",gap:12}}>
                    <div>
                      <div style={{fontSize:9,fontWeight:600,letterSpacing:1.5,textTransform:"uppercase",color:col.subtle,marginBottom:6}}>ARIA · {signal.asset} · {signal.time}</div>
                      <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                        <span style={{fontFamily:"'Libre Baskerville'",fontWeight:700,fontSize:30,color:sigColor(signal.signal),letterSpacing:-0.5,lineHeight:1}}>{signal.signal}</span>
                        <Chip label={`${signal.confidence}% conf.`} color={sigColor(signal.signal)} col={col}/>
                        <Chip label={`${signal.leverage}x`} color={col.accent} col={col}/>
                        <Chip label={signal.marketStructure} color={col.text} col={col}/>
                      </div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:9,color:col.subtle,textTransform:"uppercase",letterSpacing:1,marginBottom:3}}>R/R</div>
                      <div style={{fontFamily:"'Libre Baskerville'",fontSize:20,fontWeight:700,color:col.heading}}>1 : {fmt(signal.riskRewardRatio,2)}</div>
                    </div>
                  </div>

                  <div className="siggrid" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:20}}>
                    {[
                      {label:lang==="es"?"Entrada":"Entry",value:`$${fmt(signal.entry,dp)}`,color:col.accent},
                      {label:"Stop Loss",value:`$${fmt(signal.stopLoss,dp)}`,color:col.short},
                      {label:"Take Profit",value:`$${fmt(signal.takeProfit,dp)}`,color:col.long},
                      {label:"% Riesgo",value:`${signal.capitalToRisk}%`,color:col.wait},
                    ].map((m,i)=>(
                      <div key={i} style={{background:col.bg,borderRadius:10,padding:"11px 14px",border:`1px solid ${col.border}`}}>
                        <div style={{fontSize:9,color:col.subtle,letterSpacing:1,textTransform:"uppercase",marginBottom:3,fontWeight:600}}>{m.label}</div>
                        <div style={{fontFamily:"'DM Mono'",fontSize:14,fontWeight:700,color:m.color}}>{m.value}</div>
                      </div>
                    ))}
                  </div>

                  <p style={{fontFamily:"'Libre Baskerville'",fontStyle:"italic",fontSize:13.5,color:col.text,lineHeight:1.8,marginBottom:16}}>{signal.summary}</p>

                  {signal.hourlyOutlook&&<InfoBox title={`📅 ${lang==="es"?"Predicción Próximas 3h":"3h Outlook"}`} color={col.accent} col={col}>{signal.hourlyOutlook}</InfoBox>}
                  {signal.newsImpact&&<InfoBox title={`📰 ${lang==="es"?"Impacto Noticias":"News Impact"}`} color={col.wait} col={col}>{signal.newsImpact}</InfoBox>}
                  {signal.trendAnalysis&&<InfoBox title={`📈 ${lang==="es"?"Tendencia":"Trend"}`} color={col.subtle} col={col}>{signal.trendAnalysis}</InfoBox>}
                  {signal.technicalBasis&&<InfoBox title={lang==="es"?"Base Técnica":"Technical Basis"} color={col.subtle} col={col}>{signal.technicalBasis}</InfoBox>}

                  {signal.keyLevels?.length>0&&(
                    <div style={{marginBottom:14}}>
                      <div style={{fontSize:9,fontWeight:600,letterSpacing:1.5,textTransform:"uppercase",color:col.subtle,marginBottom:8}}>{lang==="es"?"Niveles Clave":"Key Levels"}</div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        {signal.keyLevels.map((lv,i)=><span key={i} style={{padding:"3px 12px",background:col.accentBg,border:`1px solid ${col.border}`,borderRadius:20,fontSize:11,fontFamily:"'DM Mono'",color:col.text}}>{lv}</span>)}
                      </div>
                    </div>
                  )}

                  <InfoBox title={`${lang==="es"?"Apalancamiento":"Leverage"} — ${signal.leverage}x`} color={col.accent} col={col}>{signal.leverageRationale}</InfoBox>
                  {signal.learningNote&&<InfoBox title={lang==="es"?"Aprendizaje":"Learning"} color={col.long} col={col}>{signal.learningNote}</InfoBox>}

                  {signal.warning&&<div style={{borderTop:`1px solid ${col.border}`,paddingTop:14,display:"flex",gap:9,alignItems:"flex-start",marginBottom:14}}>
                    <span style={{color:col.wait,fontSize:15,flexShrink:0}}>⚠</span>
                    <p style={{fontSize:12.5,color:col.subtle,lineHeight:1.65}}>{signal.warning}</p>
                  </div>}

                  <div style={{padding:"10px 14px",background:`${col.short}08`,border:`1px solid ${col.short}20`,borderRadius:8,fontSize:10,color:col.subtle,lineHeight:1.65}}>
                    ⚠ {lang==="es"?"Señales informativas únicamente. No asesoría financiera. El trading con apalancamiento conlleva riesgo de pérdida.":"For informational purposes only. Not financial advice. Leveraged trading carries risk of loss."}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── NEWS ── */}
          {tab==="news"&&(
            <div className="fade">
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:10}}>
                <div>
                  <h2 style={{fontFamily:"'Libre Baskerville'",fontSize:20,fontWeight:700,color:col.heading,marginBottom:4}}>{lang==="es"?"Noticias Globales":"Global News"}</h2>
                  <p style={{fontSize:12,color:col.subtle}}>Finnhub · {lang==="es"?"Actualización automática":"Auto-refresh"}</p>
                </div>
                <button className="hbtn" onClick={loadNews} style={{padding:"7px 14px",fontSize:12,color:col.text,border:`1px solid ${col.border}`,borderRadius:8,background:col.card}}>
                  {newsLoading?<span className="spin" style={{display:"inline-block"}}>⟳</span>:"⟳"} {lang==="es"?"Actualizar":"Refresh"}
                </button>
              </div>
              {!FINNHUB_KEY?(
                <div style={{background:`${col.short}0a`,border:`1px solid ${col.short}30`,borderRadius:10,padding:"18px 20px",color:col.short,fontSize:13}}>
                  ⚠ {lang==="es"?"Configura tu API key de Finnhub para ver noticias.":"Set your Finnhub API key to see news."}
                </div>
              ):newsLoading?(
                <div style={{display:"flex",alignItems:"center",gap:12,color:col.subtle,padding:"24px 0"}}>
                  <div className="spin" style={{width:16,height:16,border:`2px solid ${col.border}`,borderTopColor:col.accent,borderRadius:"50%"}}/>
                  {lang==="es"?"Cargando noticias…":"Loading news…"}
                </div>
              ):news.length===0?(
                <div style={{textAlign:"center",padding:"40px",color:col.subtle}}>{lang==="es"?"Sin noticias disponibles.":"No news available."}</div>
              ):news.map((n,i)=>(
                <a key={i} href={n.url} target="_blank" rel="noreferrer" style={{textDecoration:"none"}}>
                  <div className="mcard" style={{background:col.card,border:`1px solid ${col.border}`,borderRadius:12,padding:"16px 20px",boxShadow:col.card2,marginBottom:12,transition:"all 0.15s"}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:8,gap:12}}>
                      <div style={{fontSize:9,fontWeight:600,letterSpacing:1,textTransform:"uppercase",color:col.accent}}>{n.source}</div>
                      <div style={{fontSize:9,color:col.subtle,fontFamily:"'DM Mono'",whiteSpace:"nowrap"}}>{n.datetime}</div>
                    </div>
                    <h3 style={{fontFamily:"'Libre Baskerville'",fontSize:14,fontWeight:700,color:col.heading,lineHeight:1.4,marginBottom:8}}>{n.headline}</h3>
                    {n.summary&&<p style={{fontSize:12,color:col.subtle,lineHeight:1.6}}>{n.summary}</p>}
                  </div>
                </a>
              ))}
            </div>
          )}

          {/* ── HISTORY DB ── */}
          {tab==="history"&&(
            <div className="fade">
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:10}}>
                <div>
                  <h2 style={{fontFamily:"'Libre Baskerville'",fontSize:20,fontWeight:700,color:col.heading,marginBottom:4}}>{lang==="es"?"Historial Global de Señales":"Global Signal History"}</h2>
                  <p style={{fontSize:12,color:col.subtle}}>{dbHistory.length} {lang==="es"?"señales en la base de datos":"signals in database"}</p>
                </div>
                <button className="hbtn" onClick={loadDb} style={{padding:"7px 14px",fontSize:12,color:col.text,border:`1px solid ${col.border}`,borderRadius:8,background:col.card}}>
                  {dbLoading?<span className="spin" style={{display:"inline-block"}}>⟳</span>:"⟳"} {lang==="es"?"Actualizar":"Refresh"}
                </button>
              </div>
              {dbLoading?(
                <div style={{display:"flex",alignItems:"center",gap:12,color:col.subtle,padding:"24px 0"}}>
                  <div className="spin" style={{width:16,height:16,border:`2px solid ${col.border}`,borderTopColor:col.accent,borderRadius:"50%"}}/>
                  {lang==="es"?"Cargando…":"Loading…"}
                </div>
              ):dbHistory.length===0?(
                <div style={{textAlign:"center",padding:"48px 24px"}}>
                  <div style={{fontSize:32,marginBottom:12}}>🗄️</div>
                  <div style={{fontFamily:"'Libre Baskerville'",fontSize:17,color:col.heading,marginBottom:8}}>{lang==="es"?"Sin señales aún":"No signals yet"}</div>
                  <p style={{fontSize:12.5,color:col.subtle}}>{lang==="es"?"Genera señales con ARIA para verlas aquí":"Generate ARIA signals to see them here"}</p>
                </div>
              ):dbHistory.map((s,i)=>{
                const sc=s.signal==="LONG"?col.long:s.signal==="SHORT"?col.short:col.wait;
                const currentOutcome=outcomeMap[s.id]||s.outcome;
                return(
                  <div key={i} style={{background:col.card,border:`1px solid ${col.border}`,borderRadius:12,padding:"16px 20px",boxShadow:col.card2,marginBottom:12}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10,flexWrap:"wrap",gap:8}}>
                      <div>
                        <div style={{fontSize:9,color:col.subtle,letterSpacing:1,textTransform:"uppercase",marginBottom:4}}>
                          {s.asset} · {new Date(s.created_at).toLocaleString("es",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                          <span style={{fontFamily:"'Libre Baskerville'",fontSize:18,fontWeight:700,color:sc}}>{s.signal}</span>
                          <span style={{fontFamily:"'DM Mono'",fontSize:11,color:col.subtle}}>{s.leverage}x · {s.confidence}%</span>
                          {s.market_structure&&<span style={{fontSize:10,color:col.subtle,textTransform:"capitalize"}}>{s.market_structure}</span>}
                        </div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontSize:9,color:col.subtle,marginBottom:2}}>{lang==="es"?"Precio":"Price"}</div>
                        <div style={{fontFamily:"'DM Mono'",fontSize:14,fontWeight:700,color:col.heading}}>${s.price_at_signal}</div>
                      </div>
                    </div>
                    <div style={{display:"flex",gap:14,flexWrap:"wrap",marginBottom:10}}>
                      {[
                        {label:"Entry",value:`$${s.entry}`,color:col.accent},
                        {label:"SL",value:`$${s.stop_loss}`,color:col.short},
                        {label:"TP",value:`$${s.take_profit}`,color:col.long},
                        {label:"R/R",value:`1:${Number(s.risk_reward||0).toFixed(1)}`,color:col.text},
                      ].map((k,j)=>(
                        <span key={j} style={{fontSize:11,color:col.subtle}}>
                          <span style={{fontWeight:600}}>{k.label}: </span>
                          <span style={{fontFamily:"'DM Mono'",color:k.color,fontWeight:600}}>{k.value}</span>
                        </span>
                      ))}
                    </div>
                    {s.summary&&<p style={{fontSize:12,color:col.subtle,lineHeight:1.5,fontStyle:"italic",marginBottom:12}}>{s.summary.slice(0,160)}…</p>}
                    <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                      <span style={{fontSize:10,color:col.subtle,fontWeight:600}}>{lang==="es"?"Resultado:":"Outcome:"}</span>
                      {[
                        {key:"pending",  label:lang==="es"?"Pendiente":"Pending",   color:col.subtle},
                        {key:"win",      label:lang==="es"?"✓ Ganó":"✓ Win",        color:col.long},
                        {key:"loss",     label:lang==="es"?"✗ Perdió":"✗ Loss",     color:col.short},
                        {key:"cancelled",label:lang==="es"?"Cancelada":"Cancelled", color:col.wait},
                      ].map(o=>(
                        <button key={o.key} onClick={()=>updateOutcome(s.id,o.key)}
                          style={{padding:"3px 10px",fontSize:10,fontWeight:600,borderRadius:6,cursor:"pointer",
                            border:`1px solid ${currentOutcome===o.key?o.color:col.border}`,
                            background:currentOutcome===o.key?`${o.color}18`:"transparent",
                            color:currentOutcome===o.key?o.color:col.subtle}}>
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── PORTFOLIO ── */}
          {tab==="portfolio"&&(
            <div className="fade">
              <h2 style={{fontFamily:"'Libre Baskerville'",fontSize:20,fontWeight:700,color:col.heading,marginBottom:6}}>{lang==="es"?"Portafolio":"Portfolio"}</h2>
              <p style={{fontSize:12.5,color:col.subtle,marginBottom:22,lineHeight:1.6}}>{lang==="es"?"Señales ARIA de esta sesión.":"ARIA signals this session."}</p>
              {history.length===0?(
                <div style={{textAlign:"center",padding:"48px 24px"}}>
                  <div style={{fontSize:32,marginBottom:12}}>📊</div>
                  <div style={{fontFamily:"'Libre Baskerville'",fontSize:17,color:col.heading,marginBottom:8}}>{lang==="es"?"Sin posiciones aún":"No positions yet"}</div>
                  <p style={{fontSize:12.5,color:col.subtle}}>{lang==="es"?"Ejecuta señales de ARIA para ver el historial.":"Run ARIA signals to see history."}</p>
                </div>
              ):[...history].reverse().map((s,i)=>{
                const sc=sigColor(s.signal);
                return(
                  <div key={i} style={{background:col.card,border:`1px solid ${col.border}`,borderRadius:12,padding:"16px 20px",boxShadow:col.card2,marginBottom:12}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10,flexWrap:"wrap",gap:8}}>
                      <div>
                        <div style={{fontSize:9,color:col.subtle,letterSpacing:1,textTransform:"uppercase",marginBottom:4}}>{s.asset} · {s.time}</div>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontFamily:"'Libre Baskerville'",fontSize:18,fontWeight:700,color:sc}}>{s.signal}</span>
                          <span style={{fontFamily:"'DM Mono'",fontSize:11,color:col.subtle}}>{s.leverage}x · {s.confidence}%</span>
                        </div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontSize:9,color:col.subtle,marginBottom:2}}>{lang==="es"?"Precio entrada":"Entry"}</div>
                        <div style={{fontFamily:"'DM Mono'",fontSize:15,fontWeight:700,color:col.heading}}>${s.priceAtSignal}</div>
                      </div>
                    </div>
                    <div style={{display:"flex",gap:16,flexWrap:"wrap",marginBottom:8}}>
                      {[{label:"SL",value:`$${fmt(s.stopLoss,dp)}`,color:col.short},{label:"TP",value:`$${fmt(s.takeProfit,dp)}`,color:col.long},{label:"R/R",value:`1:${fmt(s.riskRewardRatio,1)}`,color:col.text}].map((k,j)=>(
                        <span key={j} style={{fontSize:11,color:col.subtle}}><span style={{fontWeight:600}}>{k.label}: </span><span style={{fontFamily:"'DM Mono'",color:k.color,fontWeight:600}}>{k.value}</span></span>
                      ))}
                    </div>
                    {s.hourlyOutlook&&<div style={{background:col.accentBg,borderRadius:8,padding:"8px 12px",marginBottom:8,border:`1px solid ${col.accent}25`,fontSize:11.5,color:col.text,lineHeight:1.5}}>{s.hourlyOutlook}</div>}
                    <p style={{fontSize:12,color:col.subtle,lineHeight:1.5,fontStyle:"italic"}}>{s.summary?.slice(0,140)}…</p>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>

      {/* ── Floating Chat ── */}
      <button onClick={()=>setChatOpen(o=>!o)} className="floatbtn"
        style={{position:"fixed",bottom:24,right:20,width:52,height:52,borderRadius:"50%",background:col.accent,border:"none",cursor:"pointer",boxShadow:`0 4px 20px ${col.accent}60`,display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,fontSize:chatOpen?18:22,transition:"all 0.2s",color:"#fff"}}>
        {chatOpen?"✕":"✦"}
      </button>

      {chatOpen&&(
        <div className="chatpanel" style={{position:"fixed",bottom:88,right:20,width:340,maxWidth:"calc(100vw - 32px)",height:460,background:col.surface,border:`1px solid ${col.border}`,borderRadius:16,boxShadow:col.shadow,zIndex:299,display:"flex",flexDirection:"column",overflow:"hidden"}}>
          <div style={{padding:"14px 18px",borderBottom:`1px solid ${col.border}`,display:"flex",alignItems:"center",gap:10,background:col.card}}>
            <div style={{width:32,height:32,borderRadius:"50%",background:col.accent,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <span style={{color:"#fff",fontFamily:"'Libre Baskerville'",fontWeight:700,fontSize:13}}>A</span>
            </div>
            <div>
              <div style={{fontFamily:"'Libre Baskerville'",fontWeight:700,fontSize:13,color:col.heading}}>ARIA</div>
              <div style={{fontSize:9,color:col.long,letterSpacing:1}}>● {lang==="es"?"Agente activo":"Agent active"} · {asset.label}</div>
            </div>
            <button onClick={()=>setChatMsgs([{role:"aria",text:"Chat reiniciado. ¿En qué puedo ayudarte?"}])}
              style={{marginLeft:"auto",fontSize:10,color:col.subtle,background:"none",border:`1px solid ${col.border}`,borderRadius:6,padding:"3px 8px",cursor:"pointer"}}>
              {lang==="es"?"Limpiar":"Clear"}
            </button>
          </div>
          <div style={{flex:1,overflowY:"auto",padding:"14px 16px",display:"flex",flexDirection:"column",gap:10}}>
            {chatMsgs.map((m,i)=>(
              <div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
                <div style={{maxWidth:"82%",padding:"9px 13px",borderRadius:m.role==="user"?"14px 14px 4px 14px":"14px 14px 14px 4px",background:m.role==="user"?col.accent:col.card,border:m.role==="aria"?`1px solid ${col.border}`:"none",fontSize:12.5,color:m.role==="user"?"#fff":col.text,lineHeight:1.6}}>
                  {m.text}
                </div>
              </div>
            ))}
            {chatLoading&&(
              <div style={{display:"flex",justifyContent:"flex-start"}}>
                <div style={{padding:"9px 14px",borderRadius:"14px 14px 14px 4px",background:col.card,border:`1px solid ${col.border}`,fontSize:12,color:col.subtle}}>
                  <span className="pulse" style={{display:"inline-block"}}>ARIA {lang==="es"?"está escribiendo":"is typing"}…</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef}/>
          </div>
          <div style={{padding:"12px 14px",borderTop:`1px solid ${col.border}`,display:"flex",gap:8,background:col.card}}>
            <input value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&sendChat()}
              placeholder={lang==="es"?"Pregúntale a ARIA…":"Ask ARIA…"}
              style={{flex:1,background:col.bg,border:`1px solid ${col.border}`,borderRadius:8,padding:"8px 12px",fontSize:12.5,color:col.text,outline:"none"}}/>
            <button onClick={sendChat} disabled={chatLoading||!chatInput.trim()}
              style={{padding:"8px 14px",background:col.accent,border:"none",borderRadius:8,color:"#fff",fontSize:14,fontWeight:600,cursor:"pointer",opacity:chatLoading||!chatInput.trim()?0.5:1}}>➤</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function Logo({col}){
  return(
    <div style={{display:"flex",alignItems:"center",gap:10}}>
      <div style={{width:30,height:30,background:col.accent,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
        <span style={{color:"#fff",fontFamily:"'Libre Baskerville'",fontWeight:700,fontSize:14}}>A</span>
      </div>
      <div>
        <div style={{fontFamily:"'Libre Baskerville'",fontWeight:700,fontSize:14,color:col.heading,letterSpacing:0.3}}>ARIA</div>
        <div style={{fontSize:9,color:col.subtle,letterSpacing:1.8,textTransform:"uppercase"}}>AI Trading Agent</div>
      </div>
    </div>
  );
}

function Card({title,children,col,extra}){
  return(
    <div style={{background:col.card,border:`1px solid ${col.border}`,borderRadius:12,padding:"14px 18px",boxShadow:col.card2,marginBottom:14}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <span style={{fontSize:9,fontWeight:600,letterSpacing:1.5,textTransform:"uppercase",color:col.subtle}}>{title}</span>
        {extra}
      </div>
      {children}
    </div>
  );
}

function Chip({label,color,col}){
  return(
    <span style={{padding:"3px 12px",borderRadius:6,background:`${color}15`,border:`1px solid ${color}40`,fontSize:11,fontWeight:600,color,fontFamily:"'DM Mono'"}}>{label}</span>
  );
}

function InfoBox({title,color,col,children}){
  return(
    <div style={{background:`${color}0d`,borderRadius:9,padding:"12px 16px",marginBottom:12,border:`1px solid ${color}28`}}>
      <div style={{fontSize:9,fontWeight:600,letterSpacing:1.5,textTransform:"uppercase",color,marginBottom:5}}>{title}</div>
      <p style={{fontSize:12.5,color:col.text,lineHeight:1.65}}>{children}</p>
    </div>
  );
}
