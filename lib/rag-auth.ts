import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { prisma } from "./db";
const scrypt=promisify(scryptCb);
export const authRequired=()=>process.env.RAG_AUTH_MODE==="required";
export const tokenHash=(token:string)=>createHash("sha256").update(token).digest("hex");
export async function hashPassword(password:string){const salt=randomBytes(16).toString("hex");const key=await scrypt(password,salt,64) as Buffer;return `${salt}:${key.toString("hex")}`;}
export async function verifyPassword(password:string,encoded:string){const [salt,hex]=encoded.split(":");if(!salt||!hex)return false;const key=await scrypt(password,salt,64) as Buffer;const stored=Buffer.from(hex,"hex");return key.length===stored.length&&timingSafeEqual(key,stored);}
export function cookieToken(req:Request){return req.headers.get("cookie")?.split(";").map(c=>c.trim()).find(c=>c.startsWith("raggen-session="))?.slice("raggen-session=".length)||"";}
export async function resolveIdentity(req:Request){
  if(!authRequired())return {user:{id:process.env.VIDEO_GENERATOR_USER_ID||"local-user",email:process.env.VIDEO_GENERATOR_USER_EMAIL||"local@raggen.local",name:"Local User"},workspaceId:process.env.VIDEO_GENERATOR_TENANT_ID||"raggen",role:"OWNER",workspaces:[{id:process.env.VIDEO_GENERATOR_TENANT_ID||"raggen",name:"RagGen",role:"OWNER"}]};
  const token=cookieToken(req);if(!token)return null;
  const session=await prisma.ragSession.findFirst({where:{id:tokenHash(token),expiresAt:{gt:new Date()},user:{disabled:false}},include:{user:{include:{memberships:{include:{workspace:true}}}}}});
  if(!session)return null;
  const requested=req.headers.get("x-workspace-id")||session.user.memberships[0]?.workspaceId;
  const membership=session.user.memberships.find(m=>m.workspaceId===requested);if(!membership)return null;
  return {user:{id:session.user.id,email:session.user.email,name:session.user.name},workspaceId:membership.workspaceId,role:membership.role,workspaces:session.user.memberships.map(m=>({id:m.workspaceId,name:m.workspace.name,role:m.role}))};
}
export function sameOrigin(req:Request){
  const origin=req.headers.get("origin");if(!origin)return true; // CLI bearer requests have no ambient browser Origin.
  const allowed=new Set([new URL(req.url).origin,...(process.env.RAG_ALLOWED_ORIGINS||"http://127.0.0.1:5177,http://localhost:5177,http://localhost:3101,http://127.0.0.1:3101").split(",")]);
  return allowed.has(origin);
}
