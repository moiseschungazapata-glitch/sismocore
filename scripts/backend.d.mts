export class BackendSupervisor {
  constructor(options?: { logger?: { info(message: string): void; warn(message: string): void } });
  lastError: string;
  start(): Promise<boolean>;
  ensure(): Promise<boolean>;
  stop(): void;
}
