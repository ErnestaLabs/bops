export function getSecret(account: string): Promise<string | null>;
export function setSecret(account: string, value: string): Promise<void>;
export function deleteSecret(account: string): Promise<void>;
