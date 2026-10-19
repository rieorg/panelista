import type { Timestamp } from "firebase/firestore";
import type { Category, RequestStatus, Side } from "./domain";

export interface Profile {
  uid: string;
  name: string;
  photoURL: string;
  headline: string;
  bio: string;
  titles: string[];
  yearsExp: number;
  categories: Category[];
  skills: string[];
  skillsLower?: string[];
  city: string;
  modes: ("online" | "onsite")[];
  linkedin: string;
  school: string;
  course: string;
  isStudent?: boolean;
  isEvaluator: boolean;
  accepting: boolean;
  maxActive: number;
  verified: boolean;
  banned: boolean;
  evalRatingAvg: number;
  evalRatingCount: number;
  studentRatingAvg: number;
  studentRatingCount: number;
  completedCount: number;
  activeCount: number;
  responseCount: number;
  avgResponseHours?: number;
  rank: number;
  createdAt?: Timestamp;
}

export interface Project {
  id: string;
  ownerUid: string;
  ownerName: string;
  ownerPhoto: string;
  title: string;
  abstract: string;
  school: string;
  course: string;
  categories: Category[];
  stack: string[];
  needed: number;
  acceptedCount: number;
  minYears: number;
  deadline: Timestamp;
  formUrl: string;
  mode: "online" | "onsite" | "either";
  status: "open" | "filled" | "closed";
  createdAt?: Timestamp;
}

export interface EvalRequest {
  id: string;
  projectId: string;
  projectTitle: string;
  studentUid: string;
  studentName: string;
  studentPhoto: string;
  evaluatorUid: string;
  evaluatorName: string;
  evaluatorPhoto: string;
  participants: string[];
  initiatedBy: Side;
  status: RequestStatus;
  note: string;
  lastMessage: string;
  lastSender: string;
  lastMessageAt?: Timestamp;
  reviewedByStudent: boolean;
  reviewedByEvaluator: boolean;
  updatedAt?: Timestamp;
  completedAt?: Timestamp;
}

export interface Message {
  id: string;
  senderUid: string;
  text: string;
  system?: RequestStatus;
  createdAt?: Timestamp;
}

export interface Review {
  id: string;
  fromName: string;
  fromPhoto: string;
  stars: number;
  tags: string[];
  text: string;
  projectTitle: string;
  direction: "toEvaluator" | "toStudent";
  createdAt?: Timestamp;
}
