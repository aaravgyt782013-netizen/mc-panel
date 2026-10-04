import { describe,expect,it,vi,afterEach } from "vitest";
import { MonitoringService } from "../monitoring/service.js";
const running={status:"running"} as any, stopped={status:"offline"} as any, starting={status:"starting"} as any;
function make(status=running, autoSleepMinutes=1){const stop=vi.fn(async()=>{}),sendCommand=vi.fn();const manager={status:vi.fn(()=>status),stop,sendCommand};return {monitoring:new MonitoringService(manager,{now:Date.now,intervalMs:60_000,autoSleepMinutes,historyLimit:3}),manager};}
afterEach(()=>vi.useRealTimers());
describe("Group 9 monitoring",()=>{
 it("starts the auto-sleep timer at 0 players",async()=>{vi.useFakeTimers();const {monitoring,manager}=make();monitoring.start();await vi.advanceTimersByTimeAsync(0);await vi.advanceTimersByTimeAsync(60_000);expect(manager.stop).toHaveBeenCalledTimes(1);monitoring.stop();});
 it("resets the timer when a player joins",async()=>{vi.useFakeTimers();const {monitoring,manager}=make();monitoring.start();await vi.advanceTimersByTimeAsync(30_000);monitoring.setOnlinePlayers(1);monitoring.setOnlinePlayers(0);await vi.advanceTimersByTimeAsync(30_000);expect(manager.stop).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(30_000);expect(manager.stop).toHaveBeenCalledTimes(1);monitoring.stop();});
 it("does nothing when auto-sleep is disabled",async()=>{vi.useFakeTimers();const {monitoring,manager}=make(running,0);monitoring.start();await vi.advanceTimersByTimeAsync(120_000);expect(manager.stop).not.toHaveBeenCalled();monitoring.stop();});
 it("does not fire while stopped or starting",async()=>{vi.useFakeTimers();for(const status of [stopped,starting]){const {monitoring,manager}=make(status);monitoring.start();await vi.advanceTimersByTimeAsync(120_000);expect(manager.stop).not.toHaveBeenCalled();monitoring.stop();}});
 it("keeps metric history bounded",async()=>{const {monitoring}=make();await (monitoring as any).tick();await (monitoring as any).tick();await (monitoring as any).tick();await (monitoring as any).tick();expect(monitoring.getHistory()).toHaveLength(3);monitoring.stop();});
});
