/*
 * --- desktop-exe --- The GGUF instruct models the AI studio offers to download (Q4_K_M quantisations, ~1–2.5 GB, 8k
 * context, run by llama.cpp through node-llama-cpp). Sizes and SHA-256 are the files' as published on Hugging Face (the
 * LFS object ids); a download is only used once its size and checksum match. Each model's licence is shown before the
 * download – read it: Llama 3.2 allows commercial use under Meta's community licence ("Built with Llama"), the Qwen2.5-3B
 * weights are under Qwen's research licence (non-commercial), Qwen3-4B and Qwen2.5-1.5B are Apache-2.0.
 */

export interface ModelSpec {
  id: string;
  name: string;
  file: string;
  url: string;
  size: number;
  sha256: string;
  licence: string;
  licenceUrl: string;
  /** The licence allows commercial use of what you make with it. */
  commercial: boolean;
  params: string;
}

export const DEFAULT_MODEL_ID = "llama-3.2-3b-instruct-q4km";

export const MODEL_CATALOG: readonly ModelSpec[] = [
  {
    id: "llama-3.2-3b-instruct-q4km",
    name: "Llama 3.2 3B Instruct (Q4_K_M)",
    file: "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
    url: "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
    size: 2_019_377_696,
    sha256: "6c1a2b41161032677be168d354123594c0e6e67d2b9227c84f296ad037c728ff",
    licence: "Llama 3.2 Community License",
    licenceUrl: "https://www.llama.com/llama3_2/license/",
    commercial: true,
    params: "3B",
  },
  {
    id: "qwen3-4b-instruct-2507-q4km",
    name: "Qwen3 4B Instruct 2507 (Q4_K_M)",
    file: "Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
    url: "https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
    size: 2_497_281_120,
    sha256: "3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597",
    licence: "Apache-2.0",
    licenceUrl: "https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507/blob/main/LICENSE",
    commercial: true,
    params: "4B",
  },
  {
    id: "qwen2.5-3b-instruct-q4km",
    name: "Qwen2.5 3B Instruct (Q4_K_M)",
    file: "qwen2.5-3b-instruct-q4_k_m.gguf",
    url: "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf",
    size: 2_104_932_768,
    sha256: "626b4a6678b86442240e33df819e00132d3ba7dddfe1cdc4fbb18e0a9615c62d",
    licence: "Qwen Research License (non-commercial)",
    licenceUrl: "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/blob/main/LICENSE",
    commercial: false,
    params: "3B",
  },
  {
    id: "qwen2.5-1.5b-instruct-q4km",
    name: "Qwen2.5 1.5B Instruct (Q4_K_M) – small PCs",
    file: "qwen2.5-1.5b-instruct-q4_k_m.gguf",
    url: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf",
    size: 1_117_320_736,
    sha256: "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e",
    licence: "Apache-2.0",
    licenceUrl: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/blob/main/LICENSE",
    commercial: true,
    params: "1.5B",
  },
];

export function modelById(id: string, catalog: readonly ModelSpec[] = MODEL_CATALOG): ModelSpec | undefined {
  return catalog.find((m) => m.id === id);
}
