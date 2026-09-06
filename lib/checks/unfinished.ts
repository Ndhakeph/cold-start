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

const COMMENT_OPENERS = /(\/\/|\/\*|\*|#|--|<!--|"""|''')/;
const MARKER = /\b(TODO|FIXME|HACK|XXX)\b/i;
const SKIPPED_TEST = /\.(?:skip|todo)\s*\(|\b(?:xit|xdescribe)\s*\(|@pytest\.mark\.skip\b/;
const CONFLICT = /^\s*(<<<<<<<|=======|>>>>>>>)/;

/**
 * Pattern definitions are not unfinished work. A file that searches for the
 * word TODO contains the word TODO, and reporting that is a false positive
 * that costs the whole report its credibility — so a marker only counts when
 * it appears inside a comment, and never on a line that is itself building a
 * regular expression.
 */
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

    if (CONFLICT.test(line)) {
      markers.push({ label: "merge conflict marker", line: lineNumber });
      continue;
    }

    if (definesAPattern(line)) continue;

    const marker = line.match(MARKER);
    if (marker && inComment(line, marker.index ?? 0)) {
      markers.push({ label: marker[1].toUpperCase(), line: lineNumber });
    }

    if (SKIPPED_TEST.test(line)) {
      markers.push({ label: "skipped test", line: lineNumber });
    }
  }

  return markers;
}

// Regular-expression syntax that never occurs in prose or in real calls.
function definesAPattern(line: string): boolean {
  return /\(\?[:=!<]|\\b|\\s|\\d|\[\^/.test(line);
}

function inComment(line: string, markerIndex: number): boolean {
  const opener = line.match(COMMENT_OPENERS);
  return opener !== null && (opener.index ?? Number.MAX_SAFE_INTEGER) < markerIndex;
}
