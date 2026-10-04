import os from "node:os";
import fs from "node:fs";
import { EventEmitter } from "node:events";
import type { MinecraftProcessManager } from "../minecraft/process-manager.js";
import { env } from "../config/env.js";
export interface MetricSample { timestamp:string; cpuPercent:number; memoryUsedBytes:number; memoryTotalBytes:number; diskUsedBytes:number; diskTotalBytes:number; onlinePlayers:number; }
export interface MonitoringOptions { now?:()=>number; intervalMs?:number; historyLimit?:number; autoSleepMinutes?:number; }
export class MonitoringService extends EventEmitter {
 private readonly now:()=>number; private readonly intervalMs:number; private readonly historyLimit:number; private readonly autoSleepMs:number;
 private timer:NodeJS.Timeout|null=null; private sleepTimer:NodeJS.Timeout|null=null; private lastCpu=os.cpus(); private lastCpuAt=Date.now(); private onlinePlayers=0; private history:MetricSample[]=[];
 constructor(private readonly manager:Pick<MinecraftProcessManager,"status"|"sendCommand"|"stop">,options:MonitoringOptions={}){super();this.now=options.now??Date.now;this.intervalMs=options.intervalMs??5000;this.historyLimit=Math.max(1,options.historyLimit??120);this.autoSleepMs=Math.max(0,(options.autoSleepMinutes??env.autoSleepMinutes)*60000);}
 start(){if(!this.timer){void this.tick();this.timer=setInterval(()=>void this.tick(),this.intervalMs);this.timer.unref();}}
 stop(){if(this.timer)clearInterval(this.timer);this.timer=null;this.clearSleepTimer();}
 getHistory(){return this.history.slice();}
 getOnlinePlayers(){return this.onlinePlayers;}
 ingestConsole(data:string){const match=data.match(/There are (\d+) of a max of \d+ players online/i);if(match)this.setOnlinePlayers(Number(match[1]));}
 setOnlinePlayers(count:number){const next=Math.max(0,Math.floor(count));if(next===this.onlinePlayers)return;this.onlinePlayers=next;this.emit("metrics",this.currentSample());if(next>0)this.clearSleepTimer();else this.scheduleSleepIfNeeded();}
 private async tick(){const status=this.manager.status();if(status.status!=="running"){this.clearSleepTimer();return;}try{this.manager.sendCommand("list");}catch{}const sample=this.currentSample();this.history.push(sample);if(this.history.length>this.historyLimit)this.history.splice(0,this.history.length-this.historyLimit);this.emit("metrics",sample);this.scheduleSleepIfNeeded();}
 private currentSample():MetricSample{const cpus=os.cpus(),elapsed=Math.max(1,this.now()-this.lastCpuAt);void elapsed;let idle=0,total=0,prevIdle=0,prevTotal=0;for(let i=0;i<cpus.length;i++){const a=cpus[i].times,b=this.lastCpu[i]?.times;if(!b)continue;idle+=a.idle;total+=a.user+a.nice+a.sys+a.irq+a.idle;prevIdle+=b.idle;prevTotal+=b.user+b.nice+b.sys+b.irq+b.idle;}const cpuDelta=Math.max(0,total-prevTotal),idleDelta=Math.max(0,idle-prevIdle),cpuPercent=cpuDelta?Math.min(100,Math.max(0,100-idleDelta/cpuDelta*100)):0;this.lastCpu=cpus;this.lastCpuAt=this.now();const totalMem=os.totalmem(),freeMem=os.freemem();let diskTotal=0,diskFree=0;try{const disk=fs.statfsSync(env.minecraftRoot);diskTotal=Number(disk.blocks)*Number(disk.bsize);diskFree=Number(disk.bavail)*Number(disk.bsize);}catch{}return{timestamp:new Date(this.now()).toISOString(),cpuPercent,memoryUsedBytes:totalMem-freeMem,memoryTotalBytes:totalMem,diskUsedBytes:Math.max(0,diskTotal-diskFree),diskTotalBytes:diskTotal,onlinePlayers:this.onlinePlayers};}
 private scheduleSleepIfNeeded(){if(!this.autoSleepMs||this.onlinePlayers!==0||this.manager.status().status!=="running"||this.sleepTimer)return;this.sleepTimer=setTimeout(async()=>{this.sleepTimer=null;const status=this.manager.status();if(status.status==="running"&&this.onlinePlayers===0)await this.manager.stop();},this.autoSleepMs);this.sleepTimer.unref();}
 private clearSleepTimer(){if(this.sleepTimer)clearTimeout(this.sleepTimer);this.sleepTimer=null;}
}
