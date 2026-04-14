export interface RegisterBody {
  nome: string;
  email: string;
  senha: string;
}

export interface LoginBody {
  email: string;
  senha: string;
}

export interface JwtPayload {
  userId: string;
  email: string;
}
