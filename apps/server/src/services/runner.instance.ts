import { RunnerService } from "./runner.service";
import { DbRunnerStore } from "./runner/db-store";

export const runnerService = new RunnerService({
  store: new DbRunnerStore(),
});
