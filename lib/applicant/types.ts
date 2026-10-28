// Applicant Portal types. Field names match the database columns (snake_case).

export type RequestType = "follow_up" | "change_request" | "question";
export type RequestStatus = "open" | "answered" | "closed";

export const REQUEST_TYPE_LABEL: Record<RequestType, string> = {
  follow_up: "Follow up",
  change_request: "Change request",
  question: "Question",
};

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  open: "Waiting for reply",
  answered: "Answered",
  closed: "Closed",
};

/** A message from the applicant to the registrar (table applicant_requests). */
export interface ApplicantRequest {
  id: string;
  school_id: string;
  enrollment_id: string;
  type: RequestType;
  message: string;
  status: RequestStatus;
  reply: string | null;
  created_by: string | null;
  created_by_name: string | null;
  replied_by: string | null;
  replied_by_name: string | null;
  created_at: string;
  replied_at: string | null;
  closed_at: string | null;
}

export type CivilStatus = "Single" | "Married" | "Widowed" | "Separated" | "Divorced";
export const CIVIL_STATUSES: CivilStatus[] = ["Single", "Married", "Widowed", "Separated", "Divorced"];
export const CITIZENSHIPS = ["Filipino", "American", "Chinese", "Indian", "Japanese", "Korean", "Other"];
