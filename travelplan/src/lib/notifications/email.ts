type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

const globalForEmail = globalThis as unknown as {
  emailOutbox?: EmailMessage[];
};

const outbox = globalForEmail.emailOutbox ?? [];

if (process.env.NODE_ENV !== "production") {
  globalForEmail.emailOutbox = outbox;
}

export const sendEmail = async (message: EmailMessage) => {
  if (process.env.NODE_ENV !== "production") {
    outbox.push(message);
  }
};

export const getEmailOutbox = () => [...outbox];

export const clearEmailOutbox = () => {
  outbox.length = 0;
};
