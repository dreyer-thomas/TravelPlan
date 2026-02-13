"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { Alert, Box, Button, CircularProgress, Container, Paper, TextField, Typography } from "@mui/material";

type LoginFormValues = {
  email: string;
  password: string;
};

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

export default function LoginPage() {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
    reset,
  } = useForm<LoginFormValues>({
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);

  useEffect(() => {
    const fetchCsrf = async () => {
      try {
        const response = await fetch("/api/auth/csrf", { method: "GET" });
        const body = (await response.json()) as ApiEnvelope<{ csrfToken: string }>;
        if (body.data?.csrfToken) {
          setCsrfToken(body.data.csrfToken);
        }
      } catch {
        setCsrfToken(null);
      }
    };

    fetchCsrf();
  }, []);

  const onSubmit = async (values: LoginFormValues) => {
    setServerError(null);
    setSuccess(false);

    if (!csrfToken) {
      setServerError("Security token missing. Please refresh and try again.");
      return;
    }

    let response: Response;
    try {
      response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify(values),
      });
    } catch {
      setServerError("Unable to reach the server. Please try again.");
      return;
    }

    let body: ApiEnvelope<{ userId: string }> | null = null;
    try {
      body = (await response.json()) as ApiEnvelope<{ userId: string }>;
    } catch {
      setServerError("Sign in failed. Please try again.");
      return;
    }

    if (!response.ok || body.error) {
      if (body.error?.code === "validation_error" && body.error.details) {
        const details = body.error.details as {
          fieldErrors?: Record<string, string[]>;
        };
        Object.entries(details.fieldErrors ?? {}).forEach(([field, messages]) => {
          if (messages?.[0]) {
            setError(field as keyof LoginFormValues, { message: messages[0] });
          }
        });
        return;
      }

      setServerError(body.error?.message ?? "Sign in failed. Please try again.");
      return;
    }

    setSuccess(true);
    reset({ email: "", password: "" });
    router.push("/");
  };

  const emailRules = useMemo(
    () => ({
      required: "Email is required",
      pattern: {
        value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        message: "Enter a valid email",
      },
    }),
    [],
  );

  const passwordRules = useMemo(
    () => ({
      required: "Password is required",
      minLength: { value: 8, message: "Password must be at least 8 characters" },
      maxLength: { value: 72, message: "Password must be at most 72 characters" },
    }),
    [],
  );

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 6, md: 10 } }}>
      <Paper
        elevation={1}
        sx={{
          p: { xs: 3, md: 4 },
          borderRadius: 4,
          background: "#ffffff",
        }}
      >
        <Box display="flex" flexDirection="column" gap={3}>
          <Box>
            <Typography variant="overline" color="text.secondary" letterSpacing="0.25em">
              TravelPlan
            </Typography>
            <Typography variant="h4" fontWeight={600} gutterBottom>
              Welcome back
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Sign in with your email and password to continue planning.
            </Typography>
          </Box>

          {serverError && <Alert severity="error">{serverError}</Alert>}
          {success && <Alert severity="success">Signed in successfully.</Alert>}

          <Box component="form" onSubmit={handleSubmit(onSubmit)} display="flex" flexDirection="column" gap={2}>
            <TextField
              label="Email"
              type="email"
              error={Boolean(errors.email)}
              helperText={errors.email?.message}
              {...register("email", emailRules)}
              fullWidth
            />
            <TextField
              label="Password"
              type="password"
              error={Boolean(errors.password)}
              helperText={errors.password?.message}
              {...register("password", passwordRules)}
              fullWidth
            />
            <Button type="submit" variant="contained" size="large" disabled={isSubmitting}>
              {isSubmitting ? <CircularProgress size={22} /> : "Sign in"}
            </Button>
          </Box>
        </Box>
      </Paper>
    </Container>
  );
}
