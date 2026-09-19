import { NextResponse } from "next/server";
import { resolveIdentity } from "@/lib/rag-auth";
import { apiTokenValid } from "@/auth";
export const dynamic="force-dynamic";
export async function GET(req:Request){
 if(!apiTokenValid(req))return NextResponse.json({message:"Unauthorized"},{status:401});
 const identity=await resolveIdentity(req);if(!identity)return NextResponse.json({message:"Sign in to RagGen"},{status:401});
 return NextResponse.json({accessToken:"cookie-session",accessTokenExpiresInSeconds:86400,user:{id:identity.user.id,email:identity.user.email,displayName:identity.user.name,status:"ACTIVE",platformRole:"USER",createdAt:new Date(0).toISOString()},workspaces:identity.workspaces.map(w=>({...w,slug:w.id})),defaultWorkspaceId:identity.workspaceId},{headers:{"Cache-Control":"no-store"}});
}
