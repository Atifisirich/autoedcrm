import { describe, expect, it } from "vitest";
import { mapStage, normaliseStage } from "@/lib/migration";

describe("Appendix B stage mapping", () => {
  it("normalises prefixes and year suffixes", () => {
    expect(normaliseStage("03 - Follow-up (2026)")).toBe("follow up");
    expect(normaliseStage("Cold (Raw)")).toBe("cold");
  });
  it("maps the reference CRM's stages", () => {
    const cases: [string, string, string][] = [
      ["Untouched", "", "New"], ["Inaccessible", "", "Contact attempted"], ["Not Reachable", "", "Contact attempted"],
      ["Follow-up", "Follow-up planned", "Connected"], ["Follow-up", "Campus visit planned", "Visit scheduled"], ["Follow-up", "Campus visit done", "Visit done"],
      ["Direct Walk-in", "", "Visit done"], ["Application Started", "", "Form started"], ["Step 2 Filled", "", "Form started"],
      ["Registration Payment Failed", "", "Form submitted"], ["Registration Payment Done", "", "Fee paid"], ["Admission done", "", "Admission confirmed"],
      ["Enrolled (2026)", "", "Admission confirmed"], ["Junk", "", "Junk / duplicate"], ["Cancelled", "", "Cancelled / refunded"], ["Mobile Verified", "", "New data"],
      ["Closed", "Admitted in other school", "Not interested"],
    ];
    for (const [stage, sub, ours] of cases) expect(mapStage(stage, sub)?.stage, `${stage} / ${sub}`).toBe(ours);
  });
  it("keeps the temperature of interested leads", () => {
    expect(mapStage("Interested", "Hot")).toEqual({ stage: "Interested", temperature: "Hot" });
  });
  it("returns null for unknown stages", () => {
    expect(mapStage("Something else")).toBe(null);
  });
});
