import os from "node:os";
import fs from "node:fs";
import { EventEmitter } from "node:events";
import type { MinecraftProcessManager } from "../minecraft/process-manager.js";
import { env } from "../config/env.js";

export interface MetricSample { timestamp:string; cpuPercent:number; memoryUsedBytes:number; memoryTotalBytes:number; diskUsedBytes:number; diskTotalBytes:number; onlinePlayers:number; }
export interface MetricsProvider { cpus:()=>os.CpuInfo[]; totalMemory:()=>number; freeMemory:()=>number; disk:()=>{totalBytes:number;freeBytes:number}; }
export interface MonitoringOptions { now?:()=>number; intervalMs?:number; historyLimit?:number; autoSleepMinutes?:number; metrics?:MetricsProvider; }
const realMetrics:MetricsProvider={cpus:()=>os.cpus(),totalMemory:()=>os.totalmem(),freeMemory:()=>os.freemem(),disk:()=>{const stat=fs.statfsSync(env.minecraftRoot);return{totalBytes:Number(stat.blocks)*Number(stat.bsize),freeBytes:Number(stat.bavail)*Number(stat.bsize)};}};

export class MonitoringService extends EventEmitter {
 private readonly now:()=>number; private readonly intervalMs:number; private readonly historyLimit:number; private readonly autoSleepMs:number; private readonly metrics:MetricsProvider;
 private timer:NodeJS.Timeout|null=null; private sleepTimer:NodeJS.Timeout|null=null; private lastCpu:os.CpuInfo[]; private lastCpuAt:number; private onlinePlayers=0; private history:MetricSample[]=[];
 constructor(private readonly manager:Pick<MinecraftProcessManager,"status"|"sendCommand"|"stop">,options:MonitoringOptions={}){super();this.now=options.now??Date.now;this.intervalMs=options.intervalMs??5000;this.historyLimit=Math.max(1,options.historyLimit??120);this.autoSleepMs=Math.max(0,(options.autoSleepMinutes??env.autoSleepMinutes)*60000);this.metrics=options.metrics??realMetrics;this.lastCpu=this.metrics.cpus();this.lastCpuAt=this.now();}
 start():void{if(!this.timer){void this.tick();this.timer=setInterval(()=>void this.tick(),this.intervalMs);this.timer.unref();}}
 stop():void{if(this.timer)clearInterval(this.timer);this.timer=null;this.clearSleepTimer();}
 getHistory():MetricSample[]{return this.history.slice();} getOnlinePlayers():number{return this.onlinePlayers;}
 ingestConsole(data:string):void{const match=data.match(/There are (\d+) of a max of \d+ players online/i);if(match)this.setOnlinePlayers(Number(match[1]));}
 setOnlinePlayers(count:number):void{const next=Math.max(0,Math.floor(count));if(next===this.onlinePlayers)return;this.onlinePlayers=next;this.emit("metrics",this.currentSample());if(next>0)this.clearSleepTimer();else this.scheduleSleepIfNeeded();}
 private async tick():Promise<void>{const status=this.manager.status();if(status.status!=="running"){this.clearSleepTimer();return;}try{this.manager.sendCommand("list");}catch{}const sample=this.currentSample();this.history.push(sample);if(this.history.length>this.historyLimit)this.history.splice(0,this.history.length-this.historyLimit);this.emit("metrics",sample);this.scheduleSleepIfNeeded();}
 private currentSample():MetricSample{const cpus=this.metrics.cpus();let idle=0,total=0,previousIdle=0,previousTotal=0;for(let i=0;i<cpus.length;i+=1){const current=cpus[i]?.times;const previous=this.lastCpu[i]?.times;if(!current||!previous)continue;idle+=current.idle;total+=current.user+current.nice+current.sys+current.irq+current.idle;previousIdle+=previous.idle;previousTotal+=previous.user+previous.nice+previous.sys+previous.irq+previous.idle;}const cpuDelta=Math.max(0,total-previousTotal),idleDelta=Math.max(0,idle-previousIdle),cpuPercent=cpuDelta?Math.min(100,Math.max(0,100-idleDelta/cpuDelta*100)):0;this.lastCpu=cpus;this.lastCpuAt=this.now();const totalMemory=this.metrics.totalMemory(),freeMemory=this.metrics.freeMemory(),disk=this.metrics.disk();return{timestamp:new Date(this.lastCpuAt).toISOString(),cpuPercent,memoryUsedBytes:Math.max(0,totalMemory-freeMemory),memoryTotalBytes:totalMemory,diskUsedBytes:Math.max(0,disk.totalBytes-disk.freeBytes),diskTotalBytes:disk.totalBytes,onlinePlayers:this.onlinePlayers};}
 private scheduleSleepIfNeeded():void{if(!this.autoSleepMs||this.onlinePlayers!==0||this.manager.status().status!=="running"||this.sleepTimer)return;this.sleepTimer=setTimeout(async()=>{this.sleepTimer=null;const status=this.manager.status();if(status.status==="running"&&this.onlinePlayers===0)await this.manager.stop();},this.autoSleepMs);this.sleepTimer.unref();}
 private clearSleepTimer():void{if(this.sleepTimer)clearTimeout(this.sleepTimer);this.sleepTimer=null;}
}
