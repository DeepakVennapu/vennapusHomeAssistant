import requests


class HAClient:
    def __init__(self, base_url: str, token: str):
        self._base = base_url.rstrip("/")
        self._headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

    def get_state(self, entity_id: str) -> dict:
        resp = requests.get(
            f"{self._base}/api/states/{entity_id}",
            headers=self._headers,
            timeout=5,
        )
        if resp.status_code != 200:
            raise RuntimeError(f"HA API error {resp.status_code}: {resp.text}")
        return resp.json()

    def get_states(self) -> list:
        resp = requests.get(
            f"{self._base}/api/states",
            headers=self._headers,
            timeout=10,
        )
        if resp.status_code != 200:
            raise RuntimeError(f"HA API error {resp.status_code}: {resp.text}")
        return resp.json()

    def call_service(self, domain: str, service: str, entity_id: str) -> None:
        resp = requests.post(
            f"{self._base}/api/services/{domain}/{service}",
            headers=self._headers,
            json={"entity_id": entity_id},
            timeout=5,
        )
        if resp.status_code not in (200, 201):
            raise RuntimeError(f"HA API error {resp.status_code}: {resp.text}")

    def run_script(self, script_id: str) -> None:
        resp = requests.post(
            f"{self._base}/api/services/script/turn_on",
            headers=self._headers,
            json={"entity_id": script_id},
            timeout=5,
        )
        if resp.status_code not in (200, 201):
            raise RuntimeError(f"HA API error {resp.status_code}: {resp.text}")
