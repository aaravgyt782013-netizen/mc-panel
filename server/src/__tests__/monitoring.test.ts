import { afterEach, describe, expect, it, vi } from "vitest";
import type { MinecraftStatusSnapshot } from "../minecraft/process-manager.js";
import { MonitoringService, type MetricsProvider } from "../monitoring/service.js";

const statuses:Record<"running"|"offline"|"starting",MinecraftStatusSnapshot>={running:{status:"running",pid:1,startedAt:null,stoppedAt:null,lastExitCode:null,lastCrashAt:null,restartCount:0},offline:{status:"offline",pid:null,startedAt:null,stoppedAt:null,lastExitCode:null,lastCrashAt:null,restartCount:0},starting:{status:"starting",pid:null,startedAt:null,stoppedAt:null,lastExitCode:null,lastCrashAt:null,restartCount:0}};
const fakeMetrics:MetricsProvider={cpus:()=>[{model:"test",speed:1000,times:{user:100,nice:0,sys:100,idle:800,irq:0}}],totalMemory:()=>8*1024**3,freeMemory:()=>4*1024**3,disk:()=>({totalBytes:100*1024**3,freeBytes:60*1024**3})};
function make(status:keyof typeof statuses="running",autoSleepMinutes=1){const stop=vi.fn(async()=>{}),sendCommand=vi.fn();const manager={status:vi.fn(()=>statuses[status]),stop,sendCommand};let now=0;const monitoring=new MonitoringService(manager,{now:()=>now,intervalMs:60_000,autoSleepMinutes,historyLimit:3,metrics:fakeMetrics});return{monitoring,manager,advanceNow:(ms:number)=>{now+=ms;}};}
afterEach(()=>vi.useRealTimers());
describe("Group 9 monitoring",()=>{
 it("starts the auto-sleep timer at 0 players",async()=>{vi.useFakeTimers();const{monitoring,manager}=make();monitoring.start();await vi.advanceTimersByTimeAsync(60_000);expect(manager.stop).toHaveBeenCalledTimes(1);monitoring.stop();});
 it("resets the timer when a player joins",async()=>{vi.useFakeTimers();const{monitoring,manager}=make();monitoring.start();await vi.advanceTimersByTimeAsync(30_000);monitoring.setOnlinePlayers(1);monitoring.setOnlinePlayers(0);await vi.advanceTimersByTimeAsync(30_000);expect(manager.stop).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(30_000);expect(manager.stop).toHaveBeenCalledTimes(1);monitoring.stop();});
 it("does nothing when auto-sleep is disabled",async()=>{vi.useFakeTimers();const{monitoring,manager}=make("running",0);monitoring.start();await vi.advanceTimersByTimeAsync(120_000);expect(manager.stop).not.toHaveBeenCalled();monitoring.stop();});
 it("does not fire while stopped or starting",async()=>{vi.useFakeTimers();for(const status of ["offline","starting"] as const){const{monitoring,manager}=make(status);monitoring.start();await vi.advanceTimersByTimeAsync(120_000);expect(manager.stop).not.toHaveBeenCalled();monitoring.stop();}});
 it("keeps metric history bounded without host CPU or disk reads",async()=>{vi.useFakeTimers();const{monitoring}=make("running",0);monitoring.start();await vi.advanceTimersByTimeAsync(180_000);expect(monitoring.getHistory()).toHaveLength(3);monitoring.stop();});
});
