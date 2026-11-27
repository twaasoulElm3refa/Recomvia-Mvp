"use client";

import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NavigationLink as Link } from "@/app/components/navigation-link";
import { useSiteLocale } from "@/hooks/use-site-locale";
import type { ProjectSlotSummary } from "@/db/project-slots";

export function ProjectSlotControls({
  initialProjects, projectLimit, canMonitor,
}: {
  initialProjects: ProjectSlotSummary[];
  projectLimit: number;
  canMonitor: boolean;
}) {
  const ar = useSiteLocale() === "ar";
  const router = useRouter();
  const [projects, setProjects] = useState(initialProjects);
  const [editing, setEditing] = useState<{ id: string } | null>(null);
  const currentEdit = useRef<{ id: string } | null>(null);
  const inFlight = useRef(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const count = projects.filter((item) => item.withinPlanLimit).length;

  function begin(project: ProjectSlotSummary) {
    if (inFlight.current) return;
    const edit = { id: project.id };
    currentEdit.current = edit;
    setEditing(edit);
    setValue(project.displayName);
    setError("");
  }
  function cancel() {
    if (inFlight.current) return;
    currentEdit.current = null;
    setEditing(null);
    setError("");
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || currentEdit.current !== editing || inFlight.current) return;
    const project = projects.find((item) => item.id === editing.id);
    const requestedName = value.trim();
    if (!project || !project.canRename || requestedName.length < 2 || requestedName.length > 80) return;
    // The server normalizes accepted display names to NFC before saving.
    const expectedDisplayName = requestedName.normalize("NFC");
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/projects/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id, expectedName: project.displayName, displayName: requestedName,
        }),
      });
      const body: {
        projectId?: string; displayName?: string; projectKeyUnchanged?: boolean;
        quotasReset?: boolean; code?: string;
      } = await response.json();
      if (!response.ok || body.projectId !== project.id || body.displayName !== expectedDisplayName ||
          body.projectKeyUnchanged !== true || body.quotasReset !== false) {
        throw new Error(body.code || "rename_failed");
      }
      setProjects((current) => current.map((item) =>
        item.id === project.id ? { ...item, displayName: expectedDisplayName } : item));
      currentEdit.current = null;
      setEditing(null);
      router.refresh();
    } catch {
      setError(ar
        ? "تعذّر حفظ الاسم. قد يكون تغيّر في نافذة أخرى؛ حدّث الصفحة وحاول مجددًا."
        : "Could not save the name. It may have changed in another tab; refresh and retry.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  if (!projects.length && !canMonitor) return null;
  return (
    <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold">{ar ? "المشروعات المسجلة" : "Registered projects"}</h2>
          <p className="mt-2 text-xs leading-6 text-slate-500">
            {ar
              ? "يمكن تعديل الاسم المعروض فقط. لن يتغير محتوى التقرير أو عنوان الموقع أو مواعيد المتابعة أو حصص التحليل."
              : "Only display labels can be changed. Report content, website targets, monitoring and analysis quotas remain unchanged."}
          </p>
        </div>
        <span className="rounded-xl bg-blue-50 px-3 py-2 text-sm font-bold text-blue-800">
          {canMonitor
            ? (ar ? `${count} من ${projectLimit} خانات متاحة للباقة` : `${count} of ${projectLimit} plan slots used`)
            : (ar ? "لا يوجد اشتراك شهري نشط" : "No active monthly subscription")}
        </span>
      </div>
      {!projects.length ? (
        <p className="mt-5 rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-600">
          {ar ? "ستظهر المشروعات بعد أول تحليل مؤهل." : "Projects appear after your first eligible analysis."}
        </p>
      ) : (
        <div className="mt-5 space-y-3">
          {projects.map((project) => (
            <div key={project.id} className="rounded-2xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="break-words font-bold" dir="auto">{project.displayName}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {project.withinPlanLimit
                      ? (ar ? "ضمن حد الباقة" : "Within plan limit")
                      : (ar ? "خارج الخانات النشطة في الباقة الحالية" : "Outside current plan slots")}
                    {" · "}
                    {project.completedScans} {ar ? "فحص مكتمل" : "completed scans"}
                    {project.monitoringState && <> · {ar ? "المتابعة" : "Monitoring"}: {project.monitoringState === "paused" ? (ar ? "متوقفة" : "paused") : (ar ? "مجدولة" : "scheduled")}</>}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {ar ? "سُجل" : "Registered"}: {project.createdAt} UTC
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {project.latestScanId && (
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/report?scan=${encodeURIComponent(project.latestScanId)}`}>
                        {ar ? "آخر تقرير" : "Latest report"}
                      </Link>
                    </Button>
                  )}
                  {project.canRename && editing?.id !== project.id && (
                    <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => begin(project)}>
                      {ar ? "تعديل الاسم" : "Rename"}
                    </Button>
                  )}
                </div>
              </div>
              {editing?.id === project.id && (
                <form onSubmit={save} className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                  <label className="min-w-[180px] flex-1 text-xs font-bold text-slate-600">
                    {ar ? "اسم المشروع المعروض" : "Project display name"}
                    <Input required minLength={2} maxLength={80} value={value} disabled={saving}
                      onChange={(event) => { if (!inFlight.current && currentEdit.current === editing) setValue(event.target.value); }} className="mt-1" />
                  </label>
                  <div className="flex items-end gap-2">
                    <Button type="submit" disabled={saving || value.trim().length < 2} size="sm">
                      {saving ? (ar ? "جارٍ الحفظ" : "Saving") : (ar ? "حفظ" : "Save")}
                    </Button>
                    <Button type="button" variant="outline" disabled={saving} size="sm"
                      onClick={cancel}>
                      {ar ? "إلغاء" : "Cancel"}
                    </Button>
                  </div>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
      {error && <p role="alert" className="mt-4 text-sm font-bold text-red-700">{error}</p>}
      <p className="mt-5 text-xs leading-6 text-slate-500">
        {ar
          ? "إعادة تخصيص خانات المشروعات أو حذفها غير مفعلة؛ حفاظًا على سجل الفحوص وحدود الاستهلاك."
          : "Releasing or reassigning project slots is not enabled, to preserve scan history and usage limits."}
      </p>
    </section>
  );
}
