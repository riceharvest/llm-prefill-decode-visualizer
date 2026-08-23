from enum import Enum

class GetApiRunsFormat(str, Enum):
    CSV = "csv"
    JSON = "json"

    def __str__(self) -> str:
        return str(self.value)
