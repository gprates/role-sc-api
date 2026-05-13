export interface RegisterBody {
  nome: string;
  email: string;
  senha: string;
}

export interface LoginBody {
  email: string;
  senha: string;
}

export interface ResendVerificationBody {
  email: string;
}

export interface VerifyEmailQuery {
  token: string;
}

export interface ForgotPasswordBody {
  email: string;
}

export interface VerifyResetCodeBody {
  email: string;
  code: string;
}

export interface ResetPasswordBody {
  email: string;
  resetToken: string;
  novaSenha: string;
}

export interface ChangePasswordBody {
  senhaAtual: string;
  novaSenha: string;
}

export interface UpdateProfileBody {
  nome: string;
}

export interface JwtPayload {
  userId: string;
  email: string;
}

export type VerifyEmailResult =
  | { success: true; nome: string }
  | { success: false; reason: string };
