export interface ValidateRequest {
  local_datetime: string;
  time_zone: string;
}

export interface ValidateResponse {
  status: "valid" | "invalid" | "ambiguous";
  reason_code?: string;
  message?: string;
  suggested_fixes?: Array<{ strategy: string; local_datetime: string }>;
  possible_instants?: Array<{ offset: string; instant_utc: string }>;
}

export interface ResolveRequest {
  local_datetime: string;
  time_zone: string;
  resolution_policy?: {
    ambiguous?: "earlier" | "later" | "reject";
    invalid?: "next_valid_time" | "previous_valid_time" | "reject";
  };
}

export interface ResolveResponse {
  instant_utc: string;
  offset: string;
}

export interface ConvertRequest {
  instant_utc: string;
  target_time_zone: string;
}

export interface ConvertResponse {
  local_datetime: string;
  offset: string;
  time_zone: string;
}

export type BatchItem =
  | ({ operation: "validate" } & ValidateRequest)
  | ({ operation: "resolve" } & ResolveRequest)
  | ({ operation: "convert" } & ConvertRequest);

export interface BatchResultItem {
  index: number;
  operation: string;
  success: boolean;
  data?: ValidateResponse | ResolveResponse | ConvertResponse;
  error?: { message: string; code?: string };
}

export interface BatchResponse {
  results: BatchResultItem[];
  total: number;
  succeeded: number;
  failed: number;
}

export class ChronoShieldClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(options: { baseUrl?: string; apiKey: string }) {
    this.baseUrl = (options.baseUrl || "https://chronoshieldapi.com").replace(/\/$/, "");
    this.apiKey = options.apiKey;
  }

  private async request<T>(endpoint: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(`ChronoShield API error (${response.status}): ${(error as { error: string }).error}`);
    }

    return response.json() as Promise<T>;
  }

  async validate(req: ValidateRequest): Promise<ValidateResponse> {
    return this.request<ValidateResponse>("/v1/datetime/validate", req);
  }

  async resolve(req: ResolveRequest): Promise<ResolveResponse> {
    return this.request<ResolveResponse>("/v1/datetime/resolve", req);
  }

  async convert(req: ConvertRequest): Promise<ConvertResponse> {
    return this.request<ConvertResponse>("/v1/datetime/convert", req);
  }

  async batch(items: BatchItem[]): Promise<BatchResponse> {
    return this.request<BatchResponse>("/v1/datetime/batch", { items });
  }
}
