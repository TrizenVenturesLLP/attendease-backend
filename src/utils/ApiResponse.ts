export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
  timestamp: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// JWT payload interface for authentication
export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  organizationId?: string; // For multi-tenant support (undefined for Super Admin)
}

// Express request with user and organization context
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      organizationId?: string; // Set by tenant / subdomain context middleware
      isPlatform?: boolean; // True for platform domain, false for tenant subdomains
    }
  }
}

export {};
