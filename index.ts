import express, { Handler, Router } from "express"
import cookieSession from "cookie-session"
import { body, validationResult } from "express-validator"
import { Funcionario, PrismaClient } from "@prisma/client"
import { hash, verify } from "argon2"
import helmet from "helmet"
import vhost from "vhost"
import { Server } from "socket.io"
import http from "http"

declare module "express-session" {
  interface SessionData {
    funcionario: Funcionario | null
  }
}

const prisma = new PrismaClient()

const app = express()

const server = http.createServer(app)

const io = new Server(server)

io.on("connection", (socket) => {
  console.log("a user connected")
})

app.use(express.static("public"))
app.use(express.urlencoded())
app.set("view engine", "ejs")
app.use(helmet({ contentSecurityPolicy: false, crossOriginOpenerPolicy: { policy: "unsafe-none" } }))

const subdominio = Router()

subdominio.use(cookieSession({
  name: "session",
  keys: ["XFeT6S47QJ"],
  maxAge: 24 * 60 * 60 * 1000, // 24 horas
  domain: ".localtest.me"
}))

app.use(vhost("*.localtest.me", subdominio))

app.get("/", (_req, res) => res.render("index"))

app.get("/cadastro", (_req, res) => res.render("cadastro"))

app.post(
  "/cadastro",
  body("nomeFuncionario")
    .notEmpty()
    .withMessage("Este campo é obrigatório")
    .trim()
    .escape(),
  body("email")
    .notEmpty()
    .withMessage("Este campo é obrigatório")
    .isEmail()
    .withMessage("Email inválido"),
  body("nome")
    .notEmpty()
    .withMessage("Este campo é obrigatório")
    .trim()
    .escape(),
  body("subdominio")
    .notEmpty()
    .withMessage("Este campo é obrigatório")
    .trim()
    .escape(),
  body("cnpj")
    .notEmpty()
    .withMessage("Este campo é obrigatório")
    .trim()
    .escape(),
  body("senha")
    .notEmpty()
    .withMessage("Este campo é obriga")
    .isLength({ min: 5 })
    .withMessage("Senha muito curta")
    .matches(/\d/)
    .withMessage("A senha precisa conter um número")
    .trim()
    .escape(),
  body("nome")
    .notEmpty()
    .withMessage("Este campo é obrigatório")
    .trim()
    .escape(),
  body("senha2")
    .notEmpty()
    .withMessage("Este campo é obrigatório")
    .custom((value, { req }) => {
      if (value == req.body.senha) {
        return true
      }

      throw new Error("As senhas precisam ser iguais")
    })
    .trim()
    .escape(),
  async (req, res) => {
    const errors = validationResult(req)

    if (!errors.isEmpty()) {
      return res.status(400).render("cadastro", { errors })
    }

    const { nomeFuncionario, nome, email, cnpj, subdominio, senha } = req.body

    try {
      await prisma.restaurante.create({
        data: {
          nome,
          email,
          cnpj,
          subdominio,
          funcionarios: {
            create: { nome: nomeFuncionario, email, senha: await hash(senha), cargo: "administrador" }
          }
        }
      })
    } catch (error) {
      return res.status(500).send(error)
    }

    res.redirect(`http://${subdominio}.${req.get("host")}/login`)
  }
)

const requerLogin: Handler = (req, res, next) => {
  if (req.session.funcionario) {
    next()
  } else {
    res.redirect("/login")
  }
}

const requerCargo = (cargo: "administrador" | "garçom" | "cozinheiro") => {
  const handler: Handler = (req, res, next) => {
    if (req.session.funcionario?.cargo == cargo || req.session.funcionario?.cargo == "administrador") {
      next()
    } else {
      res.redirect("/login")
    }
  }

  return handler
}

subdominio.get("/", requerLogin, async (req, res) => {
  const funcionario = req.session.funcionario!
  if (funcionario.cargo == "administrador") {
    const funcionarios = await prisma.funcionario.findMany({ where: { restauranteId: funcionario.restauranteId } })

    res.redirect("/funcionarios")
  } else {

  }
})

subdominio.get(
  "/funcionarios",
  requerCargo("administrador"),
  async (req, res) => {
    const funcionarios = await prisma.funcionario.findMany({ where: { restauranteId: req.session.funcionario!.restauranteId } })

    res.render("funcionarios", { funcionarios })
  }
)

subdominio.get("/login", (_req, res) => res.render("login"))

subdominio.post("/login", async (req, res) => {
  const { email, senha } = req.body

  const funcionario = await prisma.funcionario.findUnique({ where: { email } })

  if (!funcionario) {
    return res.status(404).send("Funcionario não encontrado")
  }

  const senhaCorreta = await verify(funcionario.senha!, senha)

  if (senhaCorreta) {
    req.session.funcionario = funcionario
    return res.redirect("/")
  } else {
    console.log("Senha incorreta!")
    return res.status(401).render("login", { erro: "Senha incorreta!" })
  }
})

app.get("/logout", (req, res) => {
  req.session.funcionario = null
  res.redirect("/login")
})

subdominio.get("/cardapio", async (req, res) => {
  const restaurante = await prisma.restaurante.findFirst({
    where: { subdominio: req.subdomains[0] },
    include: {
      categorias: {
        include: {
          subCategorias: {
            include: {
              items: true
            }
          }
        }
      }
    }
  })

  res.render("cardápio", { restaurante })
})

subdominio.get(
  "/cadastro_funcionario",
  requerCargo("administrador"),
  (_req, res) => res.render("cadastro_funcionario")
)

subdominio.post(
  "/cadastro_funcionario",
  requerCargo("administrador"),
  body("email")
    .notEmpty()
    .withMessage("Este campo é obrigatório")
    .isEmail()
    .withMessage("Email inválido"),
  body("nome")
    .notEmpty()
    .withMessage("Este campo é obrigatório")
    .isEmail()
    .withMessage("Email inválido"),
  body("senha")
    .notEmpty()
    .withMessage("Este campo é obriga")
    .isLength({ min: 5 })
    .withMessage("Senha muito curta")
    .matches(/\d/)
    .withMessage("A senha precisa conter um número")
    .trim()
    .escape(),
  body("cargo")
    .notEmpty()
    .withMessage("Este campo é obrigatório")
    .trim()
    .escape(),
  async (req, res) => {
    const errors = validationResult(req)

    if (!errors.isEmpty()) {
      return res.status(400).render("cadastro_funcionario", { errors })
    }

    const { email, nome, senha, cargo } = req.body

    try {
      await prisma.funcionario.create({
        data: {
          nome,
          email,
          senha,
          cargo,
          restauranteId: req.session.funcionario!.restauranteId
        }
      })

      return res.redirect("/funcionarios")
    } catch {

    }
  }
)

const port = 8001

app.listen(port, () => console.log(`Site rodando em http://localtest.me:${port}`))
