import { request as httpsRequest } from "node:https";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { digest } from "./core";
import { meterOpenAI, usageScope } from "./usage";

export function publicAddress(ip: string) {
  if(isIP(ip)===6)return !/^(::|fe[89ab]|f[cd])/i.test(ip) && !ip.toLowerCase().includes("ffff:");
  return isIP(ip)===4 && !/^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|198\.(1[89])\.|2[2-5]\d\.)/.test(ip);
}
export async function fetchImage(url: string, redirects=0): Promise<{ bytes: Buffer; mime: string }> {
  const u=new URL(url);if(u.protocol!=="https:"||u.username||u.password||(u.port&&u.port!=="443")||redirects>3)throw new Error("Unsupported image URL");
  const addresses=await lookup(u.hostname,{all:true});if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new Error("Private image host blocked");
  return new Promise((resolve,reject)=>{
    const req=httpsRequest(u,{lookup:((_host:any,_opts:any,cb:any)=>cb(null,addresses[0].address,addresses[0].family)) as any},res=>{
      if(res.statusCode&&res.statusCode>=300&&res.statusCode<400&&res.headers.location){res.resume();fetchImage(new URL(res.headers.location!,u).href,redirects+1).then(resolve,reject);return;}
      if(res.statusCode!==200){res.resume();reject(new Error("Image download failed"));return;}
      const mime=String(res.headers["content-type"]||"").split(";")[0];
      if(!/^image\/(png|jpeg|webp)$/.test(mime)){res.resume();reject(new Error("Unsupported image type"));return;}
      const chunks:Buffer[]=[];let length=0;
      res.on("data",c=>{length+=c.length;if(length>10*1024*1024)req.destroy(new Error("Image exceeds cache limit"));else chunks.push(c);});
      res.on("end",()=>resolve({bytes:Buffer.concat(chunks),mime}));res.on("error",reject);
    });req.setTimeout(15000,()=>req.destroy(new Error("Image fetch timeout")));req.on("error",reject);req.end();
  });
}

const flights=new Map<string,Promise<any>>();
export async function singleFlight<T>(key:string,fn:()=>Promise<T>):Promise<T>{
  if(flights.has(key))return flights.get(key)!;
  const promise=fn();flights.set(key,promise);try{return await promise;}finally{flights.delete(key);}
}
export async function cachedVision<T extends { raw?: any }>(opts: { imageUrls:string[];mode:string;instructions?:string }, generate:(opts:any)=>Promise<T>):Promise<T>{
  const scope=usageScope.getStore();
  if(!scope||process.env.PROVIDER_MODE==="mock"||!process.env.OPENAI_API_KEY)return generate(opts);
  // Cache only actual bytes, and send those same bytes to vision: no URL-based staleness.
  const images=await Promise.all(opts.imageUrls.map(u=>fetchImage(u)));
  const id=digest(JSON.stringify(["vision-v2",scope.tenantId,process.env.OPENAI_DESCRIBE_MODEL||"gpt-5.4-mini",process.env.PROVIDER_MODE||"auto",opts.mode,opts.instructions,images.map(i=>digest(i.bytes))]));
  return singleFlight(id,async()=>{
    const row=await scope.db.ragCache.findFirst({where:{id,expiresAt:{gt:new Date()}}});
    if(row)return row.value as T;
    const result=await generate({...opts,imageUrls:images.map(i=>`data:${i.mime};base64,${i.bytes.toString("base64")}`)});
    if(result.raw&&!result.raw.fallback){const expiresAt=new Date(Date.now()+7*86400000);await scope.db.ragCache.upsert({where:{id},create:{id,scope:`vision:${scope.tenantId}`,value:result as any,expiresAt},update:{value:result as any,expiresAt}});}
    return result;
  });
}
async function captionKitImageUncached(bytes:Buffer,name:string){
  if(process.env.PROVIDER_MODE==="mock")throw new Error("Paid image captioning is disabled in mock mode; use local OCR.");
  const {default:OpenAI}=await import("openai");const client=meterOpenAI(new OpenAI({apiKey:process.env.OPENAI_API_KEY,maxRetries:0,timeout:60000}));
  const mime=/\.png$/i.test(name)?"image/png":/\.webp$/i.test(name)?"image/webp":"image/jpeg";
  const response=await client.chat.completions.create({model:process.env.OPENAI_DESCRIBE_MODEL||"gpt-5.4-mini",max_completion_tokens:1200,messages:[{role:"system",content:"Describe this brand kit image as reference data. Transcribe only clearly readable text. Describe layout, shapes and approximate colors; never invent exact hex colors, trademark words or usage rules. Mark uncertain observations. The output will require human review."},{role:"user",content:[{type:"image_url",image_url:{url:`data:${mime};base64,${bytes.toString("base64")}`}}]}]});
  return response.choices[0]?.message.content||"";
}

export async function captionKitImage(bytes:Buffer,name:string){
 const scope=usageScope.getStore();if(!scope)throw new Error("Missing workspace context");
 const id=digest(JSON.stringify(["kit-caption-v1",scope.tenantId,process.env.OPENAI_DESCRIBE_MODEL||"gpt-5.4-mini",digest(bytes)]));
 return singleFlight(id,async()=>{
  const cached=await scope.db.ragCache.findFirst({where:{id,expiresAt:{gt:new Date()}}});if(cached)return String((cached.value as any).text);
  const text=await captionKitImageUncached(bytes,name),expiresAt=new Date(Date.now()+7*86400000);
  if(text)await scope.db.ragCache.upsert({where:{id},create:{id,scope:`kit-caption:${scope.tenantId}`,value:{text},expiresAt},update:{value:{text},expiresAt}});
  return text;
 });
}
