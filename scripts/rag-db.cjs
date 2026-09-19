require("dotenv").config();
const {spawnSync}=require("node:child_process");
function docker(args){return spawnSync("docker",args,{encoding:"utf8",windowsHide:true,env:{...process.env,POSTGRES_PASSWORD:process.env.DB_PASSWORD}});}
(async()=>{
 if(process.env.DB_NAME!=="raggen"||String(process.env.DB_PORT)!=="5441"||!process.env.DB_PASSWORD)throw Error("Use RagGen DB_NAME=raggen, DB_PORT=5441 and a DB_PASSWORD.");
 const inspected=docker(["inspect","raggen-db"]);
 if(inspected.status===0){
  const c=JSON.parse(inspected.stdout)[0];
  if(!c.Config.Image.startsWith("pgvector/pgvector:")||c.HostConfig.PortBindings["5432/tcp"]?.[0]?.HostPort!=="5441")throw Error("Existing raggen-db has unexpected configuration; refusing to modify it.");
  if(docker(["start","raggen-db"]).status)throw Error("Database start failed.");
 }else{
  if(docker(["run","-d","--name","raggen-db","--restart","unless-stopped","-p","127.0.0.1:5441:5432","-e",`POSTGRES_USER=${process.env.DB_USER||"video_generator"}`,"-e","POSTGRES_PASSWORD","-e","POSTGRES_DB=raggen","-v","raggen-pgvector-data:/var/lib/postgresql/data","pgvector/pgvector:pg16"]).status)throw Error("Database creation failed. Start Docker Desktop first.");
 }
 let ready=false;for(let i=0;i<60;i++){if(!docker(["exec","raggen-db","pg_isready","-U",process.env.DB_USER||"video_generator","-d","raggen"]).status){ready=true;break;}await new Promise(r=>setTimeout(r,500));}
 if(!ready)throw Error("Database is not ready.");
 if(docker(["exec","raggen-db","psql","-U",process.env.DB_USER||"video_generator","-d","raggen","-c","CREATE EXTENSION IF NOT EXISTS vector;"]).status)throw Error("Vector extension initialization failed.");
 console.log("RagGen pgvector database ready on 127.0.0.1:5441. Original database untouched.");
})().catch(e=>{console.error(e.message);process.exitCode=1;});
