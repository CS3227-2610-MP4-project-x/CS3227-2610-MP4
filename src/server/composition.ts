import "server-only";

import { Pool } from "pg";
import { getServerConfig } from "@/server/config";
import { AuthService } from "@/server/auth/auth-service";
import { PeopleRepository } from "@/server/repositories/people-repository";

export type ServerComposition = Readonly<{
  authService: AuthService;
  config: ReturnType<typeof getServerConfig>;
}>;

let composition: ServerComposition | undefined;

export function getServerComposition(): ServerComposition {
  if (composition) {
    return composition;
  }

  const config = getServerConfig();
  const databaseUrl = new URL(config.databaseUrl);
  databaseUrl.searchParams.delete("sslmode");
  const pool = new Pool({
    connectionString: databaseUrl.toString(),
    ssl: { ca: config.databaseCaCert, rejectUnauthorized: true },
  });
  const peopleRepository = new PeopleRepository(pool);
  composition = Object.freeze({ authService: new AuthService(config.appOrigin, peopleRepository), config });
  return composition;
}
