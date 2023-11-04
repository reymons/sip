import http from "http";
import sharp from "sharp";
import path from "path";
import fs from "fs";
import cp from "child_process";
import qs from "querystring";
import crypto from "crypto";
import { pipeline } from "stream";

type Format = "image/avif" | "image/webp";
type Ext = ".avif" | ".webp";

interface SipServerConfig {
    output: string;
    formats: Format[];
    context: string;
    ttl?: number;
}

interface AcceptedQuery {
    src?: string;
}

class SipServer extends http.Server {
    private readonly output: string;
    private readonly formats: Format[];
    private readonly context: string;
    private readonly ttl: number;
    private files: Set<string>;
    private readonly EXT_BY_FORMAT: Record<Format, Ext> = {
        "image/avif": ".avif",
        "image/webp": ".webp"
    }

    constructor(config: SipServerConfig) {
        super();
        if (!path.isAbsolute(config.output)) {
            throw new Error("'output' should be an absolute path");
        }
        if (!path.isAbsolute(config.context)) {
            throw new Error("'context' should be an absolute path");
        }
        this.output = config.output;
        this.formats = config.formats;
        this.context = config.context;
        this.ttl = config.ttl ?? 1000 * 60 * 60 * 24 * 7;
        this.files = new Set();
    }

    private error(res: http.ServerResponse, status: number, msg?: string) {
        res.statusCode = status;
        if (msg) {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ message: msg }));
        } else {
            res.end()
        }
    }

    private writeHead(res: http.ServerResponse, format: Format) {
        res.writeHead(200, {
            "Content-Type": format,
            "Transfer-Encoding": "chunked",
            "Connection": "keep-alive",
            "Vary": "Accept",
            "Cache-Control": `public, max-age=${this.ttl}, must-revalidate`
        });
    }

    start(port: number, callback?: () => void) {
        if (!fs.existsSync(this.output)) {
            cp.execSync(`mkdir ${this.output}`);
        }

        this.files = new Set(fs.readdirSync(this.output));

        this.on("request", (req, res) => {
            if (!req.url) {
                return this.error(res, 502, "No url");
            }
            if (req.method !== "GET") {
                return this.error(res, 405);
            }
            if (!req.headers.accept) {
                return this.error(res, 400, "No accept header");
            }
            const accepted = req.headers.accept
                                            .replaceAll(" ", "")
                                            .split(",");
            const format = this.formats.find(f => accepted.includes(f));
            if (!format) {
                return this.error(res, 502, "No format found");
            }
            const queryStr = req.url.split("?").at(1);
            if (!queryStr) {
                return this.error(res, 400, "No query");
            }
            const query = qs.parse(queryStr) as AcceptedQuery;
            if (!query.src) {
                return this.error(res, 400, "Src is empty");
            }
            query.src = decodeURIComponent(query.src);
            const ext = this.EXT_BY_FORMAT[format];
            const hash = crypto
                            .createHash("sha256")
                            .update(query.src)
                            .digest("hex") + ext;
            if (this.files.has(hash)) {
                const rs = fs.createReadStream(path.join(this.output, hash));
                this.writeHead(res, format);
                pipeline(rs, res, () => res.end());
                return;
            }
            let ss = sharp();
            switch (format) {
            case "image/avif": {
                ss = ss.avif();
                break;
            }
            case "image/webp": {
                ss = ss.webp();
                break;
            }}
            const rs = fs.createReadStream(path.join(this.context, query.src));
            const ws = fs.createWriteStream(path.join(this.output, hash));
            this.writeHead(res, format);
            pipeline(rs, ss, ws, (err) => {
                if (!err) this.files.add(hash);
            });
            pipeline(ss, res, () => res.end());
        });

        this.listen(port, callback);
    }
}

const server = new SipServer({
    output: process.cwd() + "/_images",
    context: process.cwd() + "/_dist",
    formats: ["image/avif", "image/webp"],
});

server.start(7000, () => {
    console.log("Listening on port 7000")
});
