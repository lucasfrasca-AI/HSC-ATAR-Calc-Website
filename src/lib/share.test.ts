// Written as attacks as much as round-trips: the payload comes from a URL anyone can craft.
import { test } from "node:test";
import assert from "node:assert/strict";
import sample from "../../content/sample-student.json" with { type: "json" };
import { compute, sanitise } from "./engine.ts";
import { decodeShare, encodeShare } from "./share.ts";

const strip = (d: ReturnType<typeof sanitise>) => ({ ...d, subjects: d.subjects.map(({ uid: _u, ...s }) => s) });

test("round-trip keeps every mark and reproduces the ATAR", async () => {
  const d = sanitise(sample);
  const back = await decodeShare(await encodeShare(d, true));
  assert.deepEqual(strip(back), strip(d));
  assert.equal(compute(back).atar, compute(d).atar);
});

test("the student's name is left out unless they opt in", async () => {
  const d = sanitise(sample);
  assert.equal((await decodeShare(await encodeShare(d))).name, "");
  assert.equal((await decodeShare(await encodeShare(d, true))).name, "Sample student");
});

test("links are compact enough to paste anywhere", async () => {
  const link = await encodeShare(sanitise(sample));
  assert.ok(link.startsWith("v1."));
  assert.ok(link.length < 900, `link payload is ${link.length} chars`);
});

test("garbage, wrong versions and non-base64 are rejected, not half-loaded", async () => {
  for (const bad of ["", "v1.", "v9.abc", "v1.!!!!", "v1.AAAA", "v0.bm90IGpzb24", "javascript:alert(1)"])
    await assert.rejects(decodeShare(bad), /bad-link|no-subjects/, bad);
});

test("oversized payloads are refused before and after decompression (zip bomb)", async () => {
  await assert.rejects(decodeShare("v1." + "A".repeat(20_000)), /too-large/);
  // 2 MB of zeros compresses to a tiny link; decompression must stop at the cap.
  const bomb = new Uint8Array(2_000_000).fill(32);
  const zipped = new Uint8Array(await new Response(new Blob([bomb]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
  const payload = "v1." + Buffer.from(zipped).toString("base64url");
  assert.ok(payload.length < 12_000);
  await assert.rejects(decodeShare(payload), /too-large/);
});

test("hostile content is sanitised like an import", async () => {
  const evil = { name: "<img src=x onerror=alert(1)>", settings: { level: "__proto__" }, subjects: [{ courseId: "__proto__", internalMark: "1e999", tasks: [{ name: "x".repeat(500) }] }] };
  const payload = "v0." + Buffer.from(JSON.stringify(evil)).toString("base64url");
  const d = await decodeShare(payload);
  assert.equal(d.settings.level, "average");
  assert.equal(d.subjects[0]!.courseId, "custom");
  assert.equal(d.subjects[0]!.internalMark, null);
  assert.equal(d.subjects[0]!.tasks[0]!.name.length, 80);
  assert.ok(d.name.length <= 60);
});
