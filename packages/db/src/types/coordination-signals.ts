export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue | undefined }
  | JsonValue[];

export type CoordinationSignals = {
  scheduling_availability: JsonValue | null;
  notice_preference: string | null;
  coordination_style: string | null;
};
