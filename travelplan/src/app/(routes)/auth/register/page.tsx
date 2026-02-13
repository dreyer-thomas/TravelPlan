"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Container,
  FormControlLabel,
  Paper,
  TextField,
  Typography,
} from "@mui/material";

type RegisterFormValues = {
  email: string;
  password: string;
  consent: boolean;
};

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

export default function RegisterPage() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
    reset,
  } = useForm<RegisterFormValues>({
    defaultValues: {
      email: "",
      password: "",
      consent: false,
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
        setServerError("Unable to initialize registration. Please refresh.");
      }
    };

    fetchCsrf();
  }, []);

  const onSubmit = async (values: RegisterFormValues) => {
    setServerError(null);
    setSuccess(false);

    if (!csrfToken) {
      setServerError("Security token missing. Please refresh and try again.");
      return;
    }

    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify(values),
    });

    const body = (await response.json()) as ApiEnvelope<{ userId: string }>;

    if (!response.ok || body.error) {
      if (body.error?.code === "validation_error" && body.error.details) {
        const details = body.error.details as {
          fieldErrors?: Record<string, string[]>;
        };
        Object.entries(details.fieldErrors ?? {}).forEach(([field, messages]) => {
          if (messages?.[0]) {
            setError(field as keyof RegisterFormValues, { message: messages[0] });
          }
        });
        return;
      }

      setServerError(body.error?.message ?? "Registration failed. Please try again.");
      return;
    }

    setSuccess(true);
    reset({ email: "", password: "", consent: false });
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
              Create your account
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Register with your email and password to start planning trips.
            </Typography>
          </Box>

          {serverError && <Alert severity="error">{serverError}</Alert>}
          {success && <Alert severity="success">Account created successfully.</Alert>}

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
            <FormControlLabel
              control={<Checkbox {...register("consent", { required: "Consent is required" })} />}
              label="I consent to data storage for trip planning"
            />
            {errors.consent && (
              <Typography color="error" variant="body2">
                {errors.consent.message}
              </Typography>
            )}
            <Button type="submit" variant="contained" size="large" disabled={isSubmitting}>
              {isSubmitting ? <CircularProgress size={22} /> : "Create account"}
            </Button>
          </Box>
        </Box>
      </Paper>
    </Container>
  );
}
