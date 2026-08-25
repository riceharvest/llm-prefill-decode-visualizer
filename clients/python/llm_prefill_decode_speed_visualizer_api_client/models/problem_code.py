from enum import Enum

class ProblemCode(str, Enum):
    INTERNAL = "INTERNAL"
    INVALID_CURSOR = "INVALID_CURSOR"
    INVALID_PARAMS = "INVALID_PARAMS"
    METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED"
    NOT_FOUND = "NOT_FOUND"
    RATE_LIMITED = "RATE_LIMITED"
    UPSTREAM_UNAVAILABLE = "UPSTREAM_UNAVAILABLE"

    def __str__(self) -> str:
        return str(self.value)
