type LogRequest = { url: string; body?: string };

export class InteractionSpan {
  request?: LogRequest;
  responseStatus?: number;
  responseBody?: string;
  createdAtNs: bigint;
  constructor(private kind: string) {
    this.responseStatus = undefined;
    this.responseBody = undefined;
    this.request = undefined;
    this.createdAtNs = process.hrtime.bigint();
  }

  async set_response_status(status: number) {
    this.responseStatus = status;
  }

  async set_response_body(body: string) {
    this.responseBody = body;
  }

  async set_request(url: string, body?: string) {
    this.request = {
      url,
      body,
    };
  }

  build() {
    const durationNs = process.hrtime.bigint() - this.createdAtNs;
    return {
      request: this.request,
      response: this.responseBody,
      status: this.responseStatus,
      duration: Number(durationNs) / 1_000_000_000,
      kind: this.kind,
    };
  }
}

export type InteractionLog = ReturnType<typeof InteractionSpan.prototype.build>;

export class InteractionLogs {
  private interactionLogs: InteractionLog[];
  private currentSpan: InteractionSpan | undefined;
  constructor() {
    this.interactionLogs = [];
    this.currentSpan = undefined;
  }

  span(kind: string) {
    if (this.currentSpan) {
      this.interactionLogs.push(this.currentSpan.build());
    }
    this.currentSpan = new InteractionSpan(kind);
    return this.currentSpan;
  }

  build() {
    if (this.currentSpan) {
      this.interactionLogs.push(this.currentSpan.build());
    }
    return this.interactionLogs;
  }
}
