export function emailConfig() {
  const provider = (process.env.EMAIL_PROVIDER || "").toLowerCase();
  const from = process.env.EMAIL_FROM || "";
  const key = process.env.EMAIL_API_KEY || "";
  return {
    configured: Boolean(provider && from && key),
    provider,
    from,
    key,
  };
}

export async function sendEmail({ to, subject, message }) {
  const cfg = emailConfig();
  if (!cfg.configured) {
    return {
      ok: false,
      error: "Email no configurado",
      code: "EMAIL_NOT_CONFIGURED",
    };
  }

  try {
    if (cfg.provider === "resend") {
      const { Resend } = await import("resend");
      const resend = new Resend(cfg.key);
      const { data, error } = await resend.emails.send({
        from: cfg.from,
        to,
        subject,
        text: message,
      });
      if (error) throw new Error(error.message);
      return { ok: true, id: data?.id || "", provider: cfg.provider };
    }

    if (cfg.provider === "mailgun") {
      const { default: FormData } = await import("form-data");
      const form = new FormData();
      form.append("from", cfg.from);
      form.append("to", to);
      form.append("subject", subject);
      form.append("text", message);
      const domain = cfg.from.split("@").pop();
      const res = await fetch(
        `https://api.mailgun.net/v3/${domain}/messages`,
        {
          method: "POST",
          headers: { Authorization: `Basic ${Buffer.from(`api:${cfg.key}`).toString("base64")}` },
          body: form,
        }
      );
      if (!res.ok) throw new Error(`Mailgun HTTP ${res.status}`);
      return { ok: true, provider: cfg.provider };
    }

    return {
      ok: false,
      error: `Proveedor de email no soportado: ${cfg.provider}`,
      code: "EMAIL_PROVIDER_UNSUPPORTED",
    };
  } catch (error) {
    return {
      ok: false,
      error: `Error al enviar el email: ${error.message}`,
      code: "EMAIL_SEND_FAILED",
    };
  }
}

export function mailtoUrl({ to, subject, message }) {
  return `mailto:${encodeURIComponent(to || "")}?subject=${encodeURIComponent(
    subject || ""
  )}&body=${encodeURIComponent(message || "")}`;
}