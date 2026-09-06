import type { Finding, ScannedFile } from "@/types";
import {
  capFindings,
  evidenceForLine,
  isSourceFile,
  makeFindingId,
} from "@/lib/checks/helpers";

type Marker = {
  label: string;
  line: number;
};

export function unfinished(files: ScannedFile[]) {
  const findings: Finding[] = [];

  for (const file of files.filter(isSourceFile)) {
    const markers = markersInFile(file);
    if (markers.length === 0) continue;

    const evidence = evidenceForLine(file, markers[0].line);
    findings.push({
      id: makeFindingId("unfinished", file.path, evidence.line, "markers"),
      severity: "low",
      title: `Unfinished markers in ${file.path}`,
      detail: markers.map((marker) => `${marker.label} (line ${marker.line})`).join(", "),
      evidence,
    });
  }

  return capFindings("unfinished", findings);
}

function markersInFile(file: ScannedFile): Marker[] {
  const markers: Marker[] = [];

  for (const [index, line] of file.content.split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    const todo = line.match(/\b(TODO|FIXME|HACK|XXX)\b/i)?.[1];
    if (todo) markers.push({ label: todo.toUpperCase(), line: lineNumber });

    if (/\.(?:skip|todo)\b|\b(?:xit|xdescribe)\s*\(|@pytest\.mark\.skip\b/.test(line)) {
      markers.push({ label: "skipped test", line: lineNumber });
    }

    if (/^\s*(<<<<<<<|=======|>>>>>>>)/.test(line)) {
      markers.push({ label: "merge conflict marker", line: lineNumber });
    }
  }

  return markers;
}
