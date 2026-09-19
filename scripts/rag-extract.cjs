const path=require("node:path");
const {unzipSync}=require("fflate");
const {XMLParser}=require("fast-xml-parser");
const xml=new XMLParser({ignoreAttributes:true,processEntities:false});
function zip(buffer){let total=0,count=0;return unzipSync(buffer,{filter:e=>{total+=e.originalSize;count++;if(total>30*1024*1024||count>1500)throw Error("Archive exceeds limits");if(e.name.includes("..")||e.name.startsWith("/")||e.name.includes("\\"))throw Error("Unsafe archive path");return true;}});}
function strings(node){if(typeof node==="string")return node;if(Array.isArray(node))return node.map(strings).join(" ");if(node&&typeof node==="object")return Object.entries(node).filter(([k])=>k==="a:t"||k==="w:t"||typeof node[k]==="object").map(([,v])=>strings(v)).join(" ");return "";}
let input="";process.stdin.setEncoding("utf8");process.stdin.on("data",c=>{input+=c;if(input.length>15*1024*1024)process.exit(1);});
process.stdin.on("end",async()=>{
 let worker;
 try{
 const {ext,data,ocr=false}=JSON.parse(input);const buffer=Buffer.from(data,"base64");let text="";
 const recognize=async bytes=>{if(!worker){const {createWorker}=require("tesseract.js");require("node:fs").mkdirSync(path.resolve(process.env.RAG_DATA_DIR||".rag-data","ocr"),{recursive:true});worker=await createWorker("eng",1,{cachePath:path.resolve(process.env.RAG_DATA_DIR||".rag-data","ocr"),logger:()=>{}});}return (await worker.recognize(bytes)).data.text;};
 if(ext===".pdf"){
  const {PDFParse}=require("pdf-parse");const parser=new PDFParse({data:buffer});
  try{const info=await parser.getInfo();if(info.total>(ocr?20:150))throw Error("Too many PDF pages");const result=await parser.getText();
   for(const page of result.pages){let body=page.text;if(ocr&&body.trim().length<30){const images=await parser.getScreenshot({partial:[page.num],scale:1.5,imageBuffer:true,imageDataUrl:false});body=images.pages[0]?await recognize(Buffer.from(images.pages[0].data)):body;}if(body.trim())text+=`\n[Page ${page.num}]\n${body}`;}
  }finally{await parser.destroy();}
 }else if(ext===".docx"){zip(buffer);text=(await require("mammoth").extractRawText({buffer},{externalFileAccess:false})).value;
 }else if(ext===".pptx"){const files=zip(buffer);for(const name of Object.keys(files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a,b)=>Number(a.match(/slide(\d+)/)[1])-Number(b.match(/slide(\d+)/)[1]))){text+=`\n[${name}]\n`+strings(xml.parse(Buffer.from(files[name]).toString("utf8")));}}
 else if(ocr){text=await recognize(buffer);}else throw Error("Unsupported parser format");
 if(text.length>160000)throw Error("Extracted text exceeds limit");process.stdout.write(JSON.stringify({text}));
 }catch(e){process.stdout.write(JSON.stringify({error:"Extraction failed: "+String(e.message).slice(0,200)}));process.exitCode=1;}
 finally{if(worker)await worker.terminate();}
});
