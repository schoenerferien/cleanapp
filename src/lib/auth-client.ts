import { createAuthClient } from "better-auth/react";
import { twoFactorClient, usernameClient } from "better-auth/client/plugins";

// Ohne baseURL nutzt der Client den aktuellen Origin – funktioniert lokal und über den Tunnel.
export const authClient = createAuthClient({ plugins: [usernameClient(), twoFactorClient()] });
