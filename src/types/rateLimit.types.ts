// Contador global de e-mails do dia (fuso America/Sao_Paulo).
// _id no formato "emails-AAAA-MM-DD".
export interface EmailDailyCounter {
  _id: string;
  total: number;
  expiresAt: Date;
}

// Cadastros de um IP numa hora cheia (UTC). Guarda só o HMAC do IP, nunca o
// IP. _id no formato "<ipHash>-AAAA-MM-DDTHH".
export interface RegisterIpCounter {
  _id: string;
  ipHash: string;
  total: number;
  expiresAt: Date;
}
