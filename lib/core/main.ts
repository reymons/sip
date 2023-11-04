import http from "http";
import sharp from "sharp";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { pipeline } from "stream";

type Format = "image/avif" | "image/webp";
type Ext = ".avif" | ".webp";
type Dir = Record<string, string[]>;

interface SipServerConfig {
    output: string;
    formats: Format[];
    context: string;
    ttl?: number;
}

class SipServer extends http.Server {
    private readonly EXT_BY_FORMAT: Record<Format, Ext> = {
        "image/avif": ".avif",
        "image/webp": ".webp"
    };
    private readonly output: string;
    private readonly formats: Format[];
    private readonly context: string;
    private readonly ttl: number;
    private dir: Dir;

    constructor(config: SipServerConfig) {
        if (!path.isAbsolute(config.output)) {
            throw new Error("'output' should be an absolute path");
        }
        if (!path.isAbsolute(config.context)) {
            throw new Error("'context' should be an absolute path");
        }
        super();
        this.output = config.output;
        this.formats = config.formats;
        this.context = config.context;
        this.ttl = config.ttl ?? 1000 * 60 * 60 * 24 * 1;
        this.dir = {};
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

    run(port: number, callback?: () => void) {
        if (!fs.existsSync(this.output)) {
            fs.mkdirSync(this.output);
        }

        const entries = fs.readdirSync(this.output, {
            withFileTypes: true
        });

        for (const entry of entries) {
            if (entry.isDirectory()) {
                const pathname = path.join(this.output, entry.name);
                const dirEntries = fs.readdirSync(pathname, {
                    withFileTypes: true
                });
                this.dir[entry.name] = dirEntries
                                            .filter(e => e.isFile())
                                            .map(e => e.name);
            }
        }

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
            let [fileName] = req.url.split("?");
            if (!fileName) {
                return this.error(res, 404);
            }
            fileName = decodeURIComponent(fileName);
            const ext = this.EXT_BY_FORMAT[format];
            const dirHash = crypto
                                .createHash("sha1")
                                .update(req.url)
                                .digest("hex");
            if (this.dir[dirHash]) {
                const file = this.dir[dirHash].find(file => file.endsWith(ext));
                if (file) {
                    const createdAt = Number(file.split(".")[0]);
                    const fileFullPath = path.join(this.output, dirHash, file);
                    if (Date.now() - createdAt > this.ttl) {
                        // TODO: add expired-images collector
                        fs.unlink(fileFullPath, () => {});
                        this.dir[dirHash] = this.dir[dirHash]
                                                .filter(_file => _file !== file); 
                    } else {
                        const rs = fs.createReadStream(fileFullPath);
                        this.writeHead(res, format);
                        pipeline(rs, res, () => res.end());
                        return;
                    }
                }
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
            const rs = fs.createReadStream(path.join(this.context, fileName));
            const outputFile = `${Date.now()}${ext}`;
            if (!this.dir[dirHash]) {
                fs.mkdirSync(path.join(this.output, dirHash));
            }
            const ws = fs.createWriteStream(
                path.join(this.output, dirHash, outputFile)
            );
            this.writeHead(res, format);
            pipeline(rs, ss, ws, (err) => {
                if (err) {
                    res.end();
                } else {
                    if (!this.dir[dirHash]) {
                        this.dir[dirHash] = [];
                    }
                    this.dir[dirHash].push(outputFile);
                }
            });
            pipeline(ss, res, () => res.end());
        });

        this.listen(port, callback);
    }
}

export default SipServer;
