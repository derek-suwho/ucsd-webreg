export type ParsedRow =
  | { kind: 'course'; subject: string; number: string; title: string;
      units: { from: number; to: number; inc: number };
      restriction: string[]; note?: string; description?: string }
  | { kind: 'section'; registrationNumber: number | null; meetingType: string;
      sectionCode: string | null;          // null when the row is a dated exam
      examDate: string | null;             // "2026-12-07" when dated exam row
      days: string | null; startMin: number | null; endMin: number | null;
      building: string | null; room: string | null;
      instructors: string[];               // "First Last" strings; [] = Staff
      available: number | null;            // null = Unlim
      capacity: number | null;             // null = Unlim
      waitlisted: number | null;           // from "FULL Waitlist(N)"
      cancelled: boolean; note?: string }
