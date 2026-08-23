from enum import Enum


class GetApiParseConstraintsResponse200ConstraintsDeployment(str, Enum):
    CLOUD = "cloud"
    SELF_HOSTED = "self-hosted"

    def __str__(self) -> str:
        return str(self.value)
