from enum import Enum


class ComputeInferenceArchitecture(str, Enum):
    LLAMA70B = "llama70b"
    LLAMA8B = "llama8b"
    MISTRAL7B = "mistral7b"
    QWEN72B = "qwen72b"

    def __str__(self) -> str:
        return str(self.value)
