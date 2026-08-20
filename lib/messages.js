function short(value, max) {
  const s = String(value || "").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function keyAttributes(product) {
  const keys = ["Material", "Color", "Talla", "Tamaño", "Capacidad", "Potencia", "Voltaje", "Peso"];
  const parts = [];
  for (const a of product.attributes || []) {
    const name = (a.name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (keys.some((k) => name.includes(k.toLowerCase()))) {
      parts.push(`${a.name}: ${a.value}`);
    }
  }
  return parts.join(", ");
}

function variantes(product) {
  const parts = [];
  for (const a of product.attributes || []) {
    if (/variante|sku|color|talla|opción/i.test(a.name || "")) {
      parts.push(`${a.name}: ${a.value}`);
    }
  }
  return parts.slice(0, 6).join("\n");
}

function template(product, variant) {
  const title = short(product.title, 120);
  const marca = product.marca || "tu marca";
  const modelo = product.modelo ? ` (${product.modelo})` : "";
  const fabricante = product.fabricante || "Departamento de ventas";
  const datos = [
    product.marca && `Marca: ${product.marca}`,
    product.modelo && `Modelo: ${product.modelo}`,
    product.price && `Precio de referencia: ${product.price} ${product.currency || ""}`,
    keyAttributes(product),
  ]
    .filter(Boolean)
    .join("\n");
  const extras = variantes(product);

  if (variant === 1) {
    return `Hola${fabricante ? `, soy ${""}` : ""},

Estoy interesado en el producto "${title}"${modelo} que he visto a la venta en AliExpress.

${datos}

¿Podrían confirmarme si pueden fabricar o suministrar este artículo al por mayor? Me gustaría conocer sus condiciones de pedido mínimo, precios y tiempos de producción.

Adjunto un vídeo del producto que puede ser de ayuda.

Quedo a la espera de su respuesta.
Un saludo.`;
  }

  if (variant === 2) {
    return `Estimado equipo,

He encontrado el artículo "${title}"${modelo} y creo que podría encajar en nuestro negocio.

Detalles del producto:
${datos}

${extras ? `Variantes disponibles:\n${extras}\n` : ""}
¿Es posible contactar con ustedes para tratar una compra al por mayor o una colaboración de fabricación?

Gracias por su tiempo.
Saludos cordiales.`;
  }

  return `Hola${fabricante ? ` ${fabricante}` : ""},

Quería contactar con ustedes respecto al producto "${title}"${modelo}.

Información del producto:
${datos}

${extras ? `Variantes:\n${extras}\n` : ""}
Adjunto un vídeo del producto para que puedan verlo mejor. ¿Podrían indicarme si disponen de este artículo o si pueden fabricarlo? Me interesa conocer condiciones de venta al por mayor.

Muchas gracias.
Un saludo.`;
}

export function generateSubject(product) {
  const marca = product.marca || product.fabricante || "";
  const modelo = product.modelo || "";
  const base = `Consulta sobre ${marca ? `${marca} ` : ""}${modelo ? `${modelo} ` : ""}${short(
    product.title,
    40
  )}`;
  return base.slice(0, 140);
}

export function generateMessage(product, variant = 0) {
  return template(product, variant % 3);
}

export function generateVariants(product, count = 3) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(generateMessage(product, i));
  return out;
}