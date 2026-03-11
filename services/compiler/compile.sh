#!/bin/sh
cd /workspace/projects/$1
typst compile main.typ 2>&1
