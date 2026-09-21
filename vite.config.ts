import {defineConfig,loadEnv} from 'vite';
export default defineConfig(({mode})=>{
 const env=loadEnv(mode,process.cwd(),'');
 const proxy=env.NEON_AUTH_BASE_URL?{'/api/auth':{target:env.NEON_AUTH_BASE_URL,changeOrigin:true,secure:true,rewrite:(path:string)=>path.replace(/^\/api\/auth/,'')}}:undefined;
 return {server:{port:5173,open:false,proxy},preview:{proxy},build:{target:'es2022',sourcemap:false},assetsInclude:['**/*.glsl']};
});
