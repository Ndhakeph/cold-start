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

const COMMENT_OPENER = /(\/\/|\/\*|\*|#|--|<!--|"""|''')/;
// A marker counts as a tag, not as a mention: it either opens the comment, or
// is followed immediately by a colon, a parenthesis or a dash. Prose that merely
// names one of these words is not unfinished work.
const MARKER_TAG = /^[\s*\-]*\b(TODO|FIXME|HACK|XXX)\b|\b(TODO|FIXME|HACK|XXX)\s*[:(\-]/i;
const SKIPPED_TEST = /\.(?:skip|todo)\s*\(|\b(?:xit|xdescribe)\s*\(|@pytest\.mark\.skip\b/;
const CONFLICT = /^\s*(<<<<<<<|=======|>>>>>>>)/;

/**
 * Pattern definitions are not unfinished work. A file that searches for these
 * words necessarily contains them, and reporting that back is a false positive
 * — the one failure that costs the whole report its credibility. So a marker
 * counts only inside a comment, only in tag form, and never on a line that is
 * itself building a regular expression.
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

    const marker = markerTag(line);
    if (marker) markers.push({ label: marker, line: lineNumber });

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

function markerTag(line: string): string | null {
  const opener = line.match(COMMENT_OPENER);
  if (!opener) return null;

  const body = line.slice((opener.index ?? 0) + opener[0].length);
  const match = body.match(MARKER_TAG);
  return match ? (match[1] ?? match[2]).toUpperCase() : null;
}
