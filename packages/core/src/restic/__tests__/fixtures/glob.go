package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

func main() {
	var pattern string
	if err := json.NewDecoder(os.Stdin).Decode(&pattern); err != nil {
		panic(err)
	}

	matches, err := filepath.Glob(pattern)
	if err != nil {
		panic(err)
	}
	if matches == nil {
		matches = []string{}
	}

	if err := json.NewEncoder(os.Stdout).Encode(matches); err != nil {
		panic(err)
	}
}
