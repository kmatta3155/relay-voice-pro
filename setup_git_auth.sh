#!/bin/bash
read -p "Enter your GitHub username (kmatta3155 or kmatta1): " username
read -s -p "Enter your GitHub token: " token
echo
git remote set-url origin https://$username:$token@github.com/kmatta3155/relay-voice-pro.git
echo "GitHub authentication updated!"
echo "Try running: git push"
