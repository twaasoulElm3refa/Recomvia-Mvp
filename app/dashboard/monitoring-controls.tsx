"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useSiteLocale } from "@/hooks/use-site-locale";
import type { MonitoringScheduleSummary } from "@/db/monitoring-controls";

export function MonitoringControls({
  initialSchedules, canMonitor,
}: {
  initialSchedules: MonitoringScheduleSummary[];
  canMonitor: boolean;
}) {
  const ar = useSiteLocale() === "ar";
  const router = useRouter();
  const [schedules, setSchedules] = useState(initialSchedules);
  const currentSchedules = useRef(initialSchedules);
  const inFlight = useRef(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function changeState(schedule: MonitoringScheduleSummary) {
    // React state alone cannot prevent two clicks before the next render.
    // Reject callbacks captured for a schedule that has already changed.
    if (inFlight.current || !currentSchedules.current.includes(schedule)) return;
    const action = schedule.state === "active" ? "pause" : "resume";
    if (action === "resume" && !canMonitor) return;
    inFlight.current = true;
    setBusyId(schedule.id);
    setError("");
    try {
      const response = await fetch("/api/monitoring/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleId: schedule.id, action }),
      });
      const result: { state?: "active" | "paused"; nextRunAt?: string; scanStarted?: boolean; code?: string } =
        await response.json();
      const expectedState: MonitoringScheduleSummary["state"] = action === "pause" ? "paused" : "active";
      if (!response.ok || result.state !== expectedState ||
          typeof result.nextRunAt !== "string" || !result.nextRunAt.trim() || result.scanStarted !== false) {
        throw new Error(result.code || "Monitoring update failed");
      }
      const nextRunAt = result.nextRunAt;
      const next = currentSchedules.current.map((item) => item.id === schedule.id
        ? { ...item, state: expectedState, nextRunAt } : item);
      currentSchedules.current = next;
      setSchedules(next);
      router.refresh();
    } catch {
      setError(ar ? "تعذر تحديث حالة المتابعة. حاول مرة أخرى." : "Could not update monitoring. Please try again.");
    } finally {
      inFlight.current = false;
      setBusyId(null);
    }
  }

  if (!schedules.length && !canMonitor) return null;
  return (
    <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-extrabold">{ar ? "المتابعة الدورية" : "Periodic monitoring"}</h2>
      <p className="mt-2 text-xs leading-6 text-slate-500">
        {ar
          ? "هذه جداول محفوظة وليست إثباتًا بأن المشغّل الخارجي مفعل. لا يبدأ إيقاف المتابعة أو استئنافها فحصًا جديدًا، وقد يكتمل تشغيل بدأ بالفعل."
          : "These are saved schedules, not confirmation that the external scheduler is active. Pausing or resuming never starts a scan; a run already in progress may finish."}
      </p>
      {!schedules.length ? (
        <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
          {ar ? "ستظهر مواعيد المتابعة بعد اكتمال أول تحليل مؤهل ضمن باقتك." : "Monitoring schedules will appear after the first eligible completed analysis."}
        </p>
      ) : (
        <div className="mt-5 space-y-3">
          {schedules.map((schedule) => (
            <div key={schedule.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <h3 className="font-bold" dir="auto">{schedule.targetName}</h3>
                <p className="mt-1 text-xs text-slate-600">
                  {schedule.state === "paused" ? ar ? "متوقفة مؤقتًا" : "Paused" : ar ? "الجدولة مفعلة" : "Scheduled"}
                  {schedule.leaseUntil && <> · {ar ? "قد يكون هناك تشغيل جارٍ" : "A run may be in progress"}</>}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {ar ? "الموعد المحفوظ" : "Saved next run"}: {schedule.nextRunAt} UTC
                  {schedule.lastStatus && <> · {ar ? "آخر حالة" : "Last status"}: {schedule.lastStatus}</>}
                </p>
              </div>
              <Button type="button" variant="outline" className="shrink-0 rounded-xl"
                disabled={Boolean(busyId) || (schedule.state === "paused" && !canMonitor)}
                onClick={() => void changeState(schedule)}>
                {busyId === schedule.id ? ar ? "جارٍ الحفظ…" : "Saving…" : schedule.state === "paused"
                  ? ar ? "استئناف المتابعة" : "Resume monitoring"
                  : ar ? "إيقاف المتابعة" : "Pause monitoring"}
              </Button>
            </div>
          ))}
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{error}</p>}
    </section>
  );
}
