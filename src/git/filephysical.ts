import { FSWatcher, watch } from "fs";

import { ErrorHandler } from "../util/errorhandler";
import { StatusBarView } from "../view/view";
import { GitFile } from "./filefactory";
import { GitBlameStream } from "./stream";
import {
    blankBlameInfo,
    GitBlameInfo,
    GitCommitInfo,
} from "./util/blanks";
import {
    container,
    injectable,
} from "tsyringe";

@injectable()
export class GitFilePhysical implements GitFile {
    private readonly fileName: string;
    private readonly fileSystemWatcher: FSWatcher;
    private blameInfoPromise: Promise<GitBlameInfo> | undefined;
    private blameProcess: GitBlameStream | undefined;

    public constructor(fileName: string) {
        this.fileName = fileName;
        this.fileSystemWatcher = this.setupWatcher();
    }

    public async blame(): Promise<GitBlameInfo> {
        container.resolve(StatusBarView).startProgress();

        if (this.blameInfoPromise) {
            return this.blameInfoPromise;
        } else {
            return this.findBlameInfo();
        }
    }

    public dispose(): void {
        if (this.blameProcess) {
            this.blameProcess.terminate();
            delete this.blameProcess;
        }
        this.fileSystemWatcher.close();
    }

    private setupWatcher(): FSWatcher {
        const fsWatcher = watch(this.fileName, (event: string): void => {
            if (event === "rename") {
                this.dispose();
            } else if (event === "change") {
                this.changed();
            }
        });

        return fsWatcher;
    }

    private changed(): void {
        delete this.blameInfoPromise;
    }

    private async findBlameInfo(): Promise<GitBlameInfo> {
        container.resolve(StatusBarView).startProgress();

        this.blameInfoPromise = new Promise<GitBlameInfo>(
            (resolve): void => {
                const blameInfo = blankBlameInfo();
                this.blameProcess = container.resolve(GitBlameStream);
                this.blameProcess.blame(this.fileName);

                this.blameProcess.on(
                    "commit",
                    this.gitAddCommit(blameInfo),
                );
                this.blameProcess.on(
                    "line",
                    this.gitAddLine(blameInfo),
                );
                this.blameProcess.on(
                    "end",
                    this.gitStreamOver(
                        this.blameProcess,
                        resolve,
                        blameInfo,
                    ),
                );
            },
        );

        return this.blameInfoPromise;
    }

    private gitAddCommit(
        blameInfo: GitBlameInfo,
    ): (hash: string, data: GitCommitInfo) => void {
        return (hash, data): void => {
            blameInfo.commits[hash] = data;
        };
    }

    private gitAddLine(
        blameInfo: GitBlameInfo,
    ): (line: number, gitCommitHash: string) => void {
        return (line: number, gitCommitHash: string): void => {
            blameInfo.lines[line] = gitCommitHash;
        };
    }

    private gitStreamOver(
        gitStream: GitBlameStream,
        resolve: (val: GitBlameInfo) => void,
        blameInfo: GitBlameInfo,
    ): (err: Error) => void {
        return (err: Error): void => {
            gitStream.removeAllListeners();

            if (err) {
                container.resolve(ErrorHandler).logError(err);
                resolve(blankBlameInfo());
            } else {
                container.resolve(ErrorHandler).logInfo(
                    `Blamed file "${
                        this.fileName
                    }" and found ${
                        Object.keys(blameInfo.commits).length
                    } commits`,
                );
                resolve(blameInfo);
            }
        };
    }
}
