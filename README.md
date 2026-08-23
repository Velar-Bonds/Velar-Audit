<div align="center">

<img src="web/logo-readme.jpg" alt="AUDI — Transparencia que se puede verificar" width="480">

**Auditabilidad de donaciones para el financiamiento político**

Cada donación que recibe un partido es trazable desde que llega hasta que se
verifica, se marca o se devuelve — con la evidencia anclada en una cadena
pública y la identidad del donante sin salir nunca del proveedor de KYC.

<br>

![Node.js](https://img.shields.io/badge/Node.js-22+-1d70b8?style=for-the-badge&logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-1d70b8?style=for-the-badge&logo=typescript&logoColor=white)
![Tether WDK](https://img.shields.io/badge/Tether_WDK-0c2d4a?style=for-the-badge&logo=tether&logoColor=white)
![QVAC](https://img.shields.io/badge/QVAC_Local_AI-0c2d4a?style=for-the-badge&logo=probot&logoColor=white)
![Ethereum](https://img.shields.io/badge/Sepolia-14528c?style=for-the-badge&logo=ethereum&logoColor=white)
![License](https://img.shields.io/badge/MIT-6b7885?style=for-the-badge)

</div>

---

## Qué es AUDI

Un sistema de auditoría de donaciones políticas. Un partido publica la dirección
de su billetera, un donante le manda dinero directamente, y AUDI **observa la
cadena** y construye el expediente: quién recibió cuánto, cuándo, con qué
respaldo de identidad, y si esa donación cumple la ley.

No es una plataforma de pagos. No es una pasarela. **No toca el dinero en ningún
momento.** Es el instrumento de supervisión que se sienta al lado y verifica.

## Qué es el TSE

El **Tribunal Supremo de Elecciones** de Costa Rica es el órgano constitucional
que organiza y vigila las elecciones del país. Tiene rango de cuarto poder de la
República: su independencia está en la Constitución, y entre sus funciones está
supervisar cómo se financian los partidos políticos.

Es una de las autoridades electorales más respetadas de América Latina. Y aun
así, el rastro que supervisa es de papel.

## Por qué lo necesita

Hoy nadie puede verificar de forma independiente quién dio qué, cuándo, ni si
ese dinero era legal. Los controles que existen ocurren **meses después** de una
elección: cuando el resultado ya está decidido y la plata ya se gastó.

El problema no es que falte voluntad de fiscalizar. Es que la información llega
tarde, en formato que no se puede cruzar, y proviene de los mismos partidos
supervisados.

**El presidente y los magistrados del TSE pidieron esto.** Después de ver el
trabajo de VELAR en trazabilidad de bonos, solicitaron el mismo tratamiento
aplicado a las donaciones. No es un problema hipotético inventado para tener algo
que demostrar — es un pedido de la institución que lo usaría.

## Diferencia con VELAR

**VELAR** es la plataforma completa: trazabilidad de instrumentos financieros
públicos, con el ciclo de vida de certificados de bonos como pieza central, y
arquitectura pensada para varios países de América Latina.

**AUDI** es un producto distinto sobre el mismo principio. Toma el modelo de
evidencia de VELAR — lo sensible fuera de la cadena, la prueba dentro — y lo
aplica a un problema separado: el financiamiento de partidos políticos. El ciclo
de bonos no forma parte de AUDI.

Comparten la arquitectura y el criterio. No comparten alcance ni base de datos.

---

## El problema de diseño

La identidad del donante es sensible y está protegida por ley. El **hecho** de la
donación y su estado de cumplimiento deben ser públicamente verificables.

Esos dos requisitos tiran en direcciones opuestas, y reconciliarlos es el
problema entero.

La respuesta: **los datos sensibles se quedan fuera de la cadena, con el
proveedor que los recolectó, y a la cadena solo van hashes.** Un regulador puede
verificar que una donación fue evaluada, cuándo, y contra qué evidencia — sin que
nadie averigüe quién fue el donante.

---

## Cómo funciona

### De dónde vienen las donaciones

Un donante manda USD₮ desde su propia billetera directo a la dirección pública
del partido. No hay página de pago, no hay checkout, no hay intermediario.

Esto es deliberado. En el momento en que una plataforma se sienta entre el
donante y el partido, esa plataforma se convierte en algo que el TSE tiene que
confiar — y en algo que podría reordenar, demorar u ocultar una transacción sin
que nadie lo note. Acá **la cadena es el canal de entrada**, y el trabajo del
sistema es *observarla*, no *operarla*.

### 1 — Ingreso

La billetera de donaciones del partido se construye con el **Wallet Development
Kit (WDK) de Tether** y es completamente autocustodiada: la frase semilla es del
partido, y ningún exchange ni custodio tiene los fondos.

Un indexador lee los registros `Transfer` de ERC-20 directamente de la cadena y
registra cada transacción entrante. **Una donación no puede llegar sin quedar
registrada**, porque el registro se construye de lo que dice la cadena, no de lo
que reporta el partido.

Cada partido recibe su propio índice de cuenta derivado de la misma semilla, así
que un despliegue con muchos partidos necesita una semilla y muchas direcciones —
y las donaciones a distintos partidos quedan separadas en la cadena, no por una
columna en una base de datos.

### 2 — Vínculo con la evidencia

Un proveedor externo de KYC y origen de fondos emite una **atestación** por cada
donación. El sistema guarda dos cosas:

- una **referencia pseudónima del donante**, estable entre donaciones para poder
  sumar contra el tope legal
- el **hash SHA-256** del contenido de la atestación

El contenido en sí — el nombre, el documento, el rastro bancario — nunca entra a
este sistema. El hash usa JSON canónico con claves ordenadas, así que el TSE
puede recalcularlo y obtener el mismo resultado. Eso es lo que hace la evidencia
**reproducible** en vez de simplemente almacenada.

### 3 — Cumplimiento

Un motor de reglas determinista evalúa cada donación contra la normativa de
financiamiento y decide su estado: donante extranjero, tope anual superado, KYC
sin verificar, persona políticamente expuesta, atestación ausente.

Ese motor es la fuente de verdad. Un regulador tiene que poder **reproducir** el
veredicto, y para eso hace falta que sea determinista.

Sobre ese resultado ya decidido corre un **agente QVAC con un modelo de lenguaje
en la propia máquina**, cuyo único trabajo es convertir los códigos de regla en
una frase que un auditor pueda leer. El modelo no decide: reformula.

Corre local por una razón concreta: el agente razona sobre datos de KYC y origen
de fondos. Mandar eso a una API en la nube sería entregarle a un tercero la lista
de donantes de todos los partidos del país.

### 4 — Ejecución

Las donaciones no conformes se marcan para devolución. Cuando la devolución se
ejecuta, la transacción del reembolso y toda la cadena de eventos — hash de la
atestación, veredicto, devolución — quedan ancladas en la cadena con hash,
timestamp y referencia de transacción.

La billetera del partido está limitada por una política **`returns-only`** de
WDK: las transferencias salientes se rechazan salvo que el destinatario sea una
dirección que ya le donó. Un tesorero que intente mover fondos donados a donde no
corresponde no recibe una transacción fallida — **nunca recibe una firma**.

---

## Las vistas

### Públicas, sin cuenta

| Vista | Qué hace |
|---|---|
| **Donar** (`/#/donate`) | Dirección y código QR de cada partido. El QR es un enlace EIP-681: le abre la billetera al donante ya cargada con el destinatario, la red y el contrato correctos. Muestra red, moneda aceptada y contrato del token |
| **Ingreso** (`/#/login`) | Acceso institucional. Tres cuentas de demostración con sus roles |

### Para el tribunal y los partidos

| Vista | Qué hace | Quién la ve |
|---|---|---|
| **Resumen** | Totales, distribución por estado y actividad reciente | Todos |
| **Donaciones** | Tabla completa: referencia, partido, monto, activo, país del donante, hash de atestación, estado y fecha. Filtros por estado y por activo, búsqueda por referencia, hash de transacción o dirección de origen | Todos |
| **Detalle de donación** | Expediente de una donación: datos de cadena, atestación, veredicto con sus hallazgos, anclajes de evidencia y acción de devolución si existe | Todos |
| **Centro de cumplimiento** | Solo lo que requiere atención: pendientes de atestación con su ventana de cura, y no conformes esperando devolución. Desde acá se evalúa y se ejecuta la devolución | Todos |
| **Billeteras** | Direcciones de los partidos con saldo nativo y de token, leídos de la cadena | Todos |
| **Rastro de auditoría** | Cada anclaje de evidencia: tipo, hash, raíz de Merkle y referencia de transacción, con enlace al explorador | Todos |
| **Vista de auditoría pública** | Lo que un tercero puede verificar sin conocer a nadie: donaciones, estados y evidencia, sin dato personal alguno. Emite certificados de auditoría | Solo TSE |

**Aislamiento por partido:** un tesorero de Alfa ve únicamente las donaciones de
Alfa. El TSE ve todo. El alcance se resuelve en el servidor, no ocultando filas
en el navegador.

---

## Correrlo

Requiere **Node 22 o superior**. Sin base de datos y sin claves de API.

```bash
git clone https://github.com/Velar-Bonds/Velar-Audit.git
cd Velar-Audit
npm install
cp .env.example .env
npm run wallet:new
```

Pegá la frase impresa en `.env` como `WDK_SEED_PHRASE`. Este paso no es opcional:
toda llamada que toque una billetera se niega a correr sin ella.

Generá también una clave para firmar las sesiones:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Pegala como `SESSION_SECRET`. Después:

```bash
npm start
```

Abrí <http://localhost:3400>. La contraseña de las tres cuentas es
`velar-demo-2026`:

| Cuenta | Rol | Ve |
|---|---|---|
| `tse@velar.cr` | Tribunal electoral | Todas las donaciones, de todos los partidos |
| `alfa@velar.cr` | Tesorero de partido | Solo las del Partido Alfa |
| `beta@velar.cr` | Tesorero de partido | Solo las del Partido Beta |

Lo que obtenés es una aplicación funcionando con el libro vacío. Cero donaciones
es el estado vacío real, no un placeholder: la pantalla de ingreso, el
aislamiento por partido y el tablero corren contra el mismo código que después
muestra datos de cadena en vivo. **Para esto no hacen falta fondos de testnet.**

### Cargar el escenario de demostración

Ver donaciones que cubran todos los resultados de cumplimiento significa mandar
transacciones reales en Sepolia. Eso necesita un poco de ETH de prueba gratis.

```bash
npm run donor:new
```

Pegá la frase en `.env` como `DONOR_SEED_PHRASE` y fondeá esa billetera con ETH
de Sepolia desde un faucet. Después:

```bash
npm run provision      # mintea USD₮ de prueba y da gas a los partidos
npm run seed:chain     # manda las donaciones a la cadena
```

Para una donación suelta, con el monto y el partido que quieras:

```bash
npm run donate -- alfa 1500
```

### El modelo local

```bash
npm run qvac:pull
```

Descarga los pesos una sola vez. El modelo se configura con `QVAC_MODEL` en
`.env`.

Cuando el modelo no está disponible, `assess()` devuelve los hallazgos del motor
de reglas sin frase explicativa. El estado de cumplimiento es idéntico: lo decide
el motor determinista, no el modelo.

---

## Dos decisiones de diseño que vale la pena defender

### El modelo escribe, no juzga

`src/compliance/rules.ts` decide el estado de cumplimiento.
`src/compliance/qvac-agent.ts` corre el modelo local para redactar esa decisión.

No es una limitación por conveniencia. Un veredicto de cumplimiento tiene
consecuencias legales y un regulador tiene que poder reproducirlo; un modelo de
lenguaje no es reproducible. Además, un modelo chico al que se le pregunta si una
donación extranjera es legal **inventa estatutos** — lo medimos, y ley electoral
fabricada llegando a un auditor del TSE es un daño real, no cosmético.

Por eso el modelo nunca ve una pregunta que pueda responder mal, y por eso el
sistema entero sigue funcionando sin él.

Cuando el modelo contradice al motor de reglas, la contradicción no se descarta
en silencio: levanta un hallazgo de revisión manual. El modelo puede pedir que
mire un humano; **nunca puede absolver**, porque un hallazgo de violación pesa
más que cualquier advertencia.

### Una sola cadena, siempre real

No hay modo simulado. El producto afirma que la evidencia es verificable en un
libro público, y un camino de código que finge esa afirmación es un camino que se
puede demostrar por accidente.

La red es Sepolia y el activo es USD₮ de prueba. Las transacciones son reales,
los anclajes son reales, y cualquiera puede abrirlos en el explorador.

---

## Licencia

MIT.
