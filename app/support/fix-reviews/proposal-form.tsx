"use client";

import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function FixProposalForm({ fixId, currentVersion }: { fixId: string; currentVersion: number | null }) {
  const router = useRouter();
  const [scope, setScope] = useState("");
  const [proposedText, setProposedText] = useState("");
  const [rationale, setRationale] = useState("");
  const [rollbackPlan, setRollbackPlan] = useState("");
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const lastSavedVersion = useRef<number | null>(null);
  const [error, setError] = useState("");
  const [savedVersion, setSavedVersion] = useState<number | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || lastSavedVersion.current !== savedVersion) return;
    if (scope.trim().length < 4 || proposedText.trim().length < 10 ||
        rationale.trim().length < 10 || rollbackPlan.trim().length < 10) return;
    inFlight.current = true;
    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/fix-proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fixId, scope, proposedText, rationale, rollbackPlan }),
      });
      const payload: { proposal?: { fixId?: string; version?: number }; applied?: boolean; approved?: boolean; creditsCharged?: number } = await response.json();
      const version = payload.proposal?.version;
      if (!response.ok || payload.proposal?.fixId !== fixId || typeof version !== "number" ||
          !Number.isSafeInteger(version) || version <= Math.max(savedVersion ?? 0, currentVersion ?? 0) ||
          payload.applied !== false || payload.approved !== false || payload.creditsCharged !== 0) {
        throw new Error("Draft confirmation invalid");
      }
      lastSavedVersion.current = version;
      setSavedVersion(version);
      setScope("");
      setProposedText("");
      setRationale("");
      setRollbackPlan("");
      router.refresh();
    } catch {
      setError("Could not save this proposal · تعذر حفظ المقترح");
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <h4 className="font-extrabold">Draft version {Math.max(savedVersion ?? 0, currentVersion ?? 0) + 1} · مقترح جديد</h4>
      <p className="text-xs leading-6 text-slate-500">Writing a draft is not customer approval, a Fix Credit charge or permission to modify any site.</p>
      <label className="block text-sm font-semibold">Affected scope · نطاق التغيير
        <Input required minLength={4} maxLength={200} value={scope} disabled={sending} onChange={(e) => { if (!inFlight.current && lastSavedVersion.current === savedVersion) setScope(e.target.value); }}
          placeholder="Page and element to change" className="mt-1 bg-white" />
      </label>
      <label className="block text-sm font-semibold">Proposed change · نص التعديل المقترح
        <Textarea required minLength={10} maxLength={3000} value={proposedText} disabled={sending}
          onChange={(e) => { if (!inFlight.current && lastSavedVersion.current === savedVersion) setProposedText(e.target.value); }} className="mt-1 min-h-28 bg-white" />
      </label>
      <label className="block text-sm font-semibold">Reason and evidence · أسباب التغيير
        <Textarea required minLength={10} maxLength={1200} value={rationale} disabled={sending}
          onChange={(e) => { if (!inFlight.current && lastSavedVersion.current === savedVersion) setRationale(e.target.value); }} className="mt-1 bg-white" />
      </label>
      <label className="block text-sm font-semibold">Rollback plan · خطة التراجع
        <Textarea required minLength={10} maxLength={1200} value={rollbackPlan} disabled={sending}
          onChange={(e) => { if (!inFlight.current && lastSavedVersion.current === savedVersion) setRollbackPlan(e.target.value); }} className="mt-1 bg-white" />
      </label>
      {error && <p role="alert" className="text-sm font-bold text-red-700">{error}</p>}
      {savedVersion && <p role="status" className="text-sm font-bold text-emerald-700">Version {savedVersion} saved for review · تم حفظ المقترح دون تنفيذه</p>}
      <Button type="submit" disabled={sending} className="rounded-xl bg-blue-600">
        {sending ? "Saving… · جارٍ الحفظ" : "Save draft only · حفظ المقترح فقط"}
      </Button>
    </form>
  );
}
